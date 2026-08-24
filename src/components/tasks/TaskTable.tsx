"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { downloadTasksImportTemplate, parseTasksImportFile } from "@/lib/export/tasksImport";
import {
  getProductionReleaseDateFrom,
  getSprintWindowEnd,
  parseCalendarDate,
} from "@/lib/scheduler/calendar";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { isJiraStoryLink, buildJiraIssueBrowseUrl, parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { safeStoryHref } from "@/lib/ui/safeStoryHref";
import { issueTypeChipClass } from "@/lib/ui/issueTypeChip";
import {
  buildIssueTypeFilterOptions,
  isParentlessPlannerTask,
  taskMatchesIssueTypeFilter,
} from "@/lib/planner/taskIssueFilters";
import { isTaskEligibleForJiraPull, isTaskEligibleForJiraSync, resolveTaskForJiraSync } from "@/lib/integrations/jira/syncEligibility";
import { JIRA_SYNC_ADDED_TAG } from "@/lib/integrations/jira/jiraSyncTag";
import { formatBulkSyncConfirmMessage, formatBulkSyncSummary, bulkSyncHasPartialWarnings, type BulkSyncTaskResult } from "@/lib/integrations/jira/bulkSyncMessages";
import {
  formatBulkPullConfirmMessage,
  formatBulkPullSummary,
  type BulkPullTaskResult,
} from "@/lib/integrations/jira/bulkPullMessages";
import { getCurrentStoryPhase, getStatusPhase, type StoryPhase } from "@/lib/scheduler/currentPhase";
import { effectiveMobileHours, mobileAppLabel } from "@/lib/scheduler/mobilePlatform";
import { storyPhasePlanFromTask } from "@/lib/scheduler/storyTimelineEntries";
import { getTasksNeedingRemark } from "@/lib/planner/pendingMarkProgress";
import { copySelectedStoriesToClipboard } from "@/lib/planner/copySelectedStories";
import { sortTasksForDashboard } from "@/lib/planner/dashboardTaskOrder";
import { buildReleaseGroupColorMap } from "@/lib/planner/releaseGroupColors";
import { flushPlannerStateToServer } from "@/lib/planner/flushPlannerState";
import {
  matchResourceByAssigneeLabel,
  peopleFromResources,
  resourceDisplayName,
} from "@/lib/planner/resourceIdentity";
import { schedule } from "@/lib/scheduler/engine";
import {
  thursdayReleaseChipLabel,
  type MobileAppFlag,
  type Resource,
  type Task,
  type TaskReplanStep,
} from "@/lib/scheduler/types";
import { ResourceInsightModal } from "@/components/resources/ResourceInsightModal";
import { NumberStepper } from "@/components/common/NumberStepper";
import { OrderInput } from "@/components/common/OrderInput";
import { BulkAddTasksModal } from "@/components/tasks/BulkAddTasksModal";
import { StoryLinkWithPreview } from "@/components/tasks/StoryLinkWithPreview";
import { MobileStartDateModal } from "@/components/tasks/MobileStartDateModal";
import { ReleaseGroupInput } from "@/components/tasks/ReleaseGroupInput";
import { JiraSyncBanner } from "@/components/sync/JiraSyncBanner";
import { StoryPhaseFlow } from "@/components/timeline/StoryPhaseFlow";
import { activeSprintTasks } from "@/store/taskRules";
import { taskStatuses, usePlannerStore } from "@/store/usePlannerStore";
import { useJiraSyncStore } from "@/store/useJiraSyncStore";
import {
  DEFAULT_TASK_STATUS,
  buildStatusFilterOptions,
  defaultVisibleStatusFilter,
  isDiscopedTaskStatus,
  isExcludedFromSchedule,
  isHiddenByDefaultStatusFilter,
  releaseDateHandoffLabel,
  statusChipClass,
  statusFilterClass,
  statusRowClass,
} from "@/lib/scheduler/taskStatus";

const fmt = (date: Date | null) => (date ? format(date, "EEE dd MMM, hh:mm a") : "-");
const fmtDateOnly = (date: Date) => format(date, "EEE dd MMM");
const fmtTimeOnly = (date: Date) => format(date, "hh:mm a");

const toggleName = (items: string[], value: string) =>
  items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
const clampHours = (value: number) => Math.max(0, Math.min(80, Number.isFinite(value) ? value : 0));
const assigneeLabel = (name: string, resources: Resource[]) => {
  const matched = matchResourceByAssigneeLabel(name, resources);
  return matched ? resourceDisplayName(matched) : name;
};
const openAssigneeInsight = (
  name: string,
  resources: Resource[],
  setInsightResourceName: (value: string | null) => void,
) => {
  const matched = matchResourceByAssigneeLabel(name, resources);
  setInsightResourceName(matched?.name ?? name);
};
const totalEffortHours = (task: Task) =>
  task.beHours +
  task.feHours +
  effectiveMobileHours(task) +
  task.integrationHours +
  task.qcHours +
  (task.bufferHours ?? 0);

const canCalculateRelease = (task: Task) =>
  !isExcludedFromSchedule(task.status) &&
  (task.feHours > 0 ||
    task.beHours > 0 ||
    effectiveMobileHours(task) > 0 ||
    task.integrationHours > 0 ||
    task.qcHours > 0 ||
    (task.bufferHours ?? 0) > 0);

const defaultVisibleStatuses = defaultVisibleStatusFilter(taskStatuses);
const developmentHours = (task: Task) =>
  task.beHours + task.feHours + effectiveMobileHours(task) + task.integrationHours;
const replanStepOptions: { value: Exclude<TaskReplanStep, "Buffer">; label: string; hint: string }[] = [
  { value: "Start", label: "Start", hint: "Replan from the beginning." },
  { value: "FE", label: "FE", hint: "Treat BE as completed." },
  { value: "Integration", label: "Integration", hint: "Treat FE and BE as completed." },
  { value: "QC", label: "QC", hint: "Treat FE, BE, and Integration as completed." },
];

const replanStepSelectValue = (step: TaskReplanStep | null | undefined): Exclude<TaskReplanStep, "Buffer"> => {
  if (step === "FE" || step === "Integration" || step === "QC") {
    return step;
  }
  if (step === "Buffer") {
    return "QC";
  }
  return "Start";
};

const storyHref = safeStoryHref;

const storyDisplayName = (task: Pick<Task, "id" | "storyName" | "storyLink">) => {
  const name = (task.storyName ?? "").trim();
  if (name) return name;
  const issueKey = parseJiraIssueKey(task.storyLink);
  if (issueKey) return issueKey;
  const link = task.storyLink.trim();
  if (link) return link;
  return "Untitled story";
};

const RELEASE_GROUP_HELP =
  "Release group: stories with the same name share UAT and production release dates (case-sensitive). Use for bundles that must ship together.";

const splitTodoLines = (raw: string | undefined) =>
  (raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const formatTagLabel = (tag: string) => tag.trim().split(/\s+/).join(" - ");

const toolbarTriggerClass = (active: boolean, extraClass = "") =>
  ["toolbar-strip-btn", "inline-flex", "items-center", "gap-1.5", active ? "toolbar-strip-btn-active" : "", extraClass]
    .filter(Boolean)
    .join(" ");

function ToolbarMenuChevron({ open }: { open: boolean }) {
  return (
    <span className="toolbar-strip-btn-chevron" aria-hidden>
      {open ? "▴" : "▾"}
    </span>
  );
}

function ToolbarDropdownHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="toolbar-dropdown-header">
      <div className="toolbar-dropdown-title">{title}</div>
      {subtitle ? <div className="toolbar-dropdown-subtitle">{subtitle}</div> : null}
    </div>
  );
}

type AssigneePickerKind = "be" | "fe" | "android" | "ios" | "int" | "qc" | "pm" | "status";

type AssigneePickerOpen = {
  taskId: string;
  kind: AssigneePickerKind;
  trigger: HTMLElement;
} | null;

export function TaskTable() {
  const { data: session } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const role = session?.user?.role;
  const caps =
    role && session?.user?.email ? getCapabilities(plannerAccessContext(session, activeSquadId)) : null;
  const isEditor = Boolean(caps?.canWrite);
  const canManageSprintLifecycle = Boolean(caps?.canManageSprintLifecycle);
  const tasks = usePlannerStore((state) => state.tasks);
  const resources = usePlannerStore((state) => state.resources);
  const result = usePlannerStore((state) => state.result);
  const config = usePlannerStore((state) => state.config);
  const plannerMeta = usePlannerStore((state) => state.plannerMeta);
  const hasHydrated = usePlannerStore((state) => state.hasHydrated);
  const addTask = usePlannerStore((state) => state.addTask);
  const addTasks = usePlannerStore((state) => state.addTasks);
  const updateTask = usePlannerStore((state) => state.updateTask);
  const updateTasks = usePlannerStore((state) => state.updateTasks);
  const removeTask = usePlannerStore((state) => state.removeTask);
  const markProgressNow = usePlannerStore((state) => state.markProgressNow);
  const sprintBoardGeneration = usePlannerStore((state) => state.sprintBoardGeneration);
  const [insightResourceName, setInsightResourceName] = useState<string | null>(null);
  const [taskPendingDelete, setTaskPendingDelete] = useState<string | null>(null);
  const [taskTagModalId, setTaskTagModalId] = useState<string | null>(null);
  const [taskTodoModalId, setTaskTodoModalId] = useState<string | null>(null);
  const [moStartDateModalId, setMoStartDateModalId] = useState<string | null>(null);
  const [isBulkAddOpen, setIsBulkAddOpen] = useState(false);
  const [tagInputDraft, setTagInputDraft] = useState("");
  const [todoModalDraft, setTodoModalDraft] = useState("");
  const [isImportingTasks, setIsImportingTasks] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const linkInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const sprintFilterRef = useRef<HTMLDivElement | null>(null);
  const statusFilterRef = useRef<HTMLDivElement | null>(null);
  const jiraSyncActive = useJiraSyncStore((state) => state.active);
  const jiraSyncMode = useJiraSyncStore((state) => state.mode);
  const jiraSyncPhase = useJiraSyncStore((state) => state.phase);
  const startJiraSync = useJiraSyncStore((state) => state.start);
  const markJiraRunning = useJiraSyncStore((state) => state.markRunning);
  const markJiraDone = useJiraSyncStore((state) => state.markDone);
  const setJiraSyncPhase = useJiraSyncStore((state) => state.setPhase);
  const finishJiraSync = useJiraSyncStore((state) => state.finish);
  const [isMarkingProgress, setIsMarkingProgress] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [expandedJiraTaskIds, setExpandedJiraTaskIds] = useState<string[]>([]);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState<{
    taskId: string;
    trigger: HTMLElement;
  } | null>(null);
  const mobileOptionsPanelRef = useRef<HTMLDivElement | null>(null);
  const [mobileOptionsPos, setMobileOptionsPos] = useState({ top: 0, left: 0, width: 260 });
  const [storyFieldsOpen, setStoryFieldsOpen] = useState<{ taskId: string; trigger: HTMLElement } | null>(null);
  const [storyFieldsDraft, setStoryFieldsDraft] = useState({ storyName: "", storyLink: "" });
  const storyFieldsDraftRef = useRef(storyFieldsDraft);
  storyFieldsDraftRef.current = storyFieldsDraft;
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const storyFieldsMenuRef = useRef<HTMLFormElement | null>(null);
  const [storyFieldsMenuPos, setStoryFieldsMenuPos] = useState({ top: 0, left: 0, width: 248 });
  const [isBulkStoryMenuOpen, setIsBulkStoryMenuOpen] = useState(false);
  const bulkStoryMenuRef = useRef<HTMLDivElement | null>(null);
  const bulkStoryMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const bulkStoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const [bulkStoryMenuPos, setBulkStoryMenuPos] = useState({ top: 0, left: 0 });
  const assigneePickerRef = useRef<HTMLDivElement | null>(null);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState<AssigneePickerOpen>(null);
  const [assigneePickerPos, setAssigneePickerPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({
    top: 0,
    left: 0,
    width: 180,
    maxHeight: 240,
  });
  const [visibleStatuses, setVisibleStatuses] = useState<string[]>(defaultVisibleStatuses);
  const [sprintFilter, setSprintFilter] = useState<"all" | "currentSprint" | "nextSprint">("currentSprint");
  const [emFilter, setEmFilter] = useState<"all" | "em" | "non-em">("all");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<"all" | "stories" | "standalone">("all");
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [ownerFilterOpen, setOwnerFilterOpen] = useState(false);
  const [kindFilterOpen, setKindFilterOpen] = useState(false);
  const [tasksMenuOpen, setTasksMenuOpen] = useState(false);
  const typeFilterRef = useRef<HTMLDivElement | null>(null);
  const ownerFilterRef = useRef<HTMLDivElement | null>(null);
  const kindFilterRef = useRef<HTMLDivElement | null>(null);
  const tasksMenuRef = useRef<HTMLDivElement | null>(null);
  const [isSprintFilterOpen, setIsSprintFilterOpen] = useState(false);
  const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const lastHandledSprintBoardGeneration = useRef(0);

  // Carry-overs become current-sprint rows; leave Next Sprint filter would look like an empty board.
  useEffect(() => {
    if (sprintBoardGeneration === 0 || sprintBoardGeneration === lastHandledSprintBoardGeneration.current) {
      return;
    }
    lastHandledSprintBoardGeneration.current = sprintBoardGeneration;
    setSprintFilter("currentSprint");
    setVisibleStatuses((current) => {
      const hasToDo = current.some((status) => status.trim().toLowerCase() === "to do");
      return hasToDo ? current : [...current, DEFAULT_TASK_STATUS];
    });
    setActionFeedback(
      "New sprint started. All stories stayed on the board; showing Current Sprint.",
    );
  }, [sprintBoardGeneration]);

  useEffect(() => {
    if (!actionFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setActionFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  const feOptions = resources.filter((item) => item.type === "FE");
  const beOptions = resources.filter((item) => item.type === "BE");
  const mobileOptions = resources.filter((item) => item.type === "MO");
  const qcOptions = resources.filter((item) => item.type === "QC");
  const pmOptions = resources.filter((item) => item.type === "PM");
  const activeTasks = useMemo(() => activeSprintTasks(tasks), [tasks]);
  const safeResult = useMemo(() => {
    if (result.tasks.length > 0 || tasks.length === 0) {
      return result;
    }
    return schedule(activeTasks, resources, config);
  }, [result, tasks, resources, config, activeTasks]);
  const taskResultMap = useMemo(() => new Map(safeResult.tasks.map((item) => [item.id, item])), [safeResult.tasks]);
  const pendingMarkProgressIds = useMemo(
    () => getTasksNeedingRemark(plannerMeta, activeTasks.map((task) => task.id)),
    [plannerMeta, activeTasks],
  );
  const anyEmStoryMarked = useMemo(() => tasks.some((task) => Boolean(task.isEmStory)), [tasks]);
  const [selectedTimelineTaskId, setSelectedTimelineTaskId] = useState<string | null>(null);
  const selectedTimelineTask = useMemo(
    () => (selectedTimelineTaskId ? tasks.find((task) => task.id === selectedTimelineTaskId) ?? null : null),
    [tasks, selectedTimelineTaskId],
  );
  const selectedTimelineComputed = useMemo(
    () => (selectedTimelineTaskId ? taskResultMap.get(selectedTimelineTaskId) ?? null : null),
    [taskResultMap, selectedTimelineTaskId],
  );
  const selectedTimelineHandoffLabel = selectedTimelineTask
    ? releaseDateHandoffLabel(selectedTimelineTask.status)
    : null;
  const modalCurrentPhase = useMemo(
    () =>
      selectedTimelineComputed && selectedTimelineTask
        ? getCurrentStoryPhase({
            ...selectedTimelineComputed,
            replanFromStep: selectedTimelineTask.replanFromStep,
          })
        : "None",
    [selectedTimelineComputed, selectedTimelineTask],
  );
  const isUatTrackingEnabled = plannerMeta.uatTrackingEnabled;
  const tagModalTask = useMemo(() => tasks.find((t) => t.id === taskTagModalId) ?? null, [tasks, taskTagModalId]);
  const todoModalTask = useMemo(() => tasks.find((t) => t.id === taskTodoModalId) ?? null, [tasks, taskTodoModalId]);
  const moStartDateModalTask = useMemo(
    () => (moStartDateModalId ? tasks.find((t) => t.id === moStartDateModalId) ?? null : null),
    [tasks, moStartDateModalId],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedTimelineTaskId(null);
        setIsSprintFilterOpen(false);
        setIsStatusFilterOpen(false);
        setInsightResourceName(null);
        setTaskPendingDelete(null);
        setTaskTagModalId(null);
        setTaskTodoModalId(null);
        setMoStartDateModalId(null);
        setIsBulkAddOpen(false);
        setAssigneePickerOpen(null);
        setIsBulkStoryMenuOpen(false);
        setStoryFieldsOpen(null);
        setTypeFilterOpen(false);
        setOwnerFilterOpen(false);
        setKindFilterOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sprintFilterRef.current && !sprintFilterRef.current.contains(target)) {
        setIsSprintFilterOpen(false);
      }
      if (statusFilterRef.current && !statusFilterRef.current.contains(target)) {
        setIsStatusFilterOpen(false);
      }
      if (typeFilterRef.current && !typeFilterRef.current.contains(target)) {
        setTypeFilterOpen(false);
      }
      if (ownerFilterRef.current && !ownerFilterRef.current.contains(target)) {
        setOwnerFilterOpen(false);
      }
      if (kindFilterRef.current && !kindFilterRef.current.contains(target)) {
        setKindFilterOpen(false);
      }
      if (tasksMenuRef.current && !tasksMenuRef.current.contains(target)) {
        setTasksMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const closeOtherFilterMenus = useCallback((keep: "sprint" | "status" | "type" | "owner" | "kind") => {
    if (keep !== "sprint") setIsSprintFilterOpen(false);
    if (keep !== "status") setIsStatusFilterOpen(false);
    if (keep !== "type") setTypeFilterOpen(false);
    if (keep !== "owner") setOwnerFilterOpen(false);
    if (keep !== "kind") setKindFilterOpen(false);
    setTasksMenuOpen(false);
  }, []);

  const handleAddTask = useCallback(() => {
    if (!isEditor) return;
    if (!visibleStatuses.includes(DEFAULT_TASK_STATUS)) {
      setVisibleStatuses((current) => [...current, DEFAULT_TASK_STATUS]);
    }
    if (sprintFilter === "nextSprint") {
      setSprintFilter("currentSprint");
    }
    const id = addTask();
    setFocusTaskId(id);
    setTasksMenuOpen(false);
  }, [addTask, isEditor, sprintFilter, visibleStatuses]);

  const ownerFilterSummary = emFilter === "em" ? "EM" : emFilter === "non-em" ? "Team" : "";
  const kindFilterSummary =
    kindFilter === "stories" ? "Stories" : kindFilter === "standalone" ? "Standalone" : "";

  const statusFilterOptions = useMemo(
    () => buildStatusFilterOptions(taskStatuses, tasks.map((task) => task.status)),
    [tasks],
  );
  const defaultVisibleStatusOptions = useMemo(
    () => defaultVisibleStatusFilter(statusFilterOptions),
    [statusFilterOptions],
  );

  // Include unknown Jira statuses from tasks so they are not permanently hidden.
  useEffect(() => {
    setVisibleStatuses((current) => {
      if (current.length === 0) {
        return current;
      }
      const currentKeys = new Set(current.map((status) => status.trim().toLowerCase()));
      const knownKeys = new Set(taskStatuses.map((status) => status.trim().toLowerCase()));
      const toAdd = statusFilterOptions.filter((status) => {
        const key = status.trim().toLowerCase();
        if (currentKeys.has(key) || knownKeys.has(key)) {
          return false;
        }
        return !isHiddenByDefaultStatusFilter(status);
      });
      return toAdd.length === 0 ? current : [...current, ...toAdd];
    });
  }, [statusFilterOptions]);

  const sprintFilterSummary =
    sprintFilter === "currentSprint" ? "Current" : sprintFilter === "nextSprint" ? "Next" : "All";

  const isStatusFilterCustom = useMemo(() => {
    if (visibleStatuses.length !== defaultVisibleStatusOptions.length) return true;
    const visibleKeys = new Set(visibleStatuses.map((status) => status.trim().toLowerCase()));
    return !defaultVisibleStatusOptions.every((status) => visibleKeys.has(status.trim().toLowerCase()));
  }, [visibleStatuses, defaultVisibleStatusOptions]);

  const markProgressHoverHint = useMemo(() => {
    const pendingCount = pendingMarkProgressIds.size;
    if (pendingCount > 0) {
      const noun = pendingCount === 1 ? "story needs" : "stories need";
      return `${pendingCount} ${noun} remark. Use Mark Progress Now to refresh Cur UAT/Production dates after hours or schedule edits.`;
    }
    if (isUatTrackingEnabled) {
      return "Replan remaining work from the current time and refresh Cur UAT/Production dates.";
    }
    return "Start release tracking and lock Cur UAT/Production dates from the current schedule.";
  }, [pendingMarkProgressIds.size, isUatTrackingEnabled]);

  useEffect(() => {
    if (!assigneePickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (assigneePickerRef.current?.contains(target)) {
        return;
      }
      if (assigneePickerOpen.trigger?.contains(target)) {
        return;
      }
      setAssigneePickerOpen(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [assigneePickerOpen]);

  useEffect(() => {
    if (!mobileOptionsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (mobileOptionsPanelRef.current?.contains(target)) {
        return;
      }
      if (mobileOptionsOpen.trigger?.contains(target)) {
        return;
      }
      setMobileOptionsOpen(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [mobileOptionsOpen]);

  useEffect(() => {
    if (!mobileOptionsOpen?.trigger) {
      return;
    }
    const updatePosition = () => {
      const trigger = mobileOptionsOpen.trigger;
      if (!trigger?.isConnected) {
        setMobileOptionsOpen(null);
        return;
      }
      positionMobileOptions(trigger);
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [mobileOptionsOpen]);

  useEffect(() => {
    if (!assigneePickerOpen?.trigger) {
      return;
    }
    const updatePosition = () => {
      const trigger = assigneePickerOpen.trigger;
      if (!trigger?.isConnected) {
        setAssigneePickerOpen(null);
        return;
      }
      positionAssigneePicker(trigger);
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [assigneePickerOpen]);

  useEffect(() => {
    if (!isBulkStoryMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bulkStoryMenuRef.current?.contains(target) || bulkStoryMenuPanelRef.current?.contains(target)) {
        return;
      }
      setIsBulkStoryMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isBulkStoryMenuOpen]);

  const commitOpenStoryFields = useCallback(
    (close: boolean) => {
      const openId = storyFieldsOpen?.taskId;
      if (!openId) return;
      const task = usePlannerStore.getState().tasks.find((item) => item.id === openId);
      const draft = storyFieldsDraftRef.current;
      if (task) {
        const patch: Partial<Task> = {};
        if ((task.storyName ?? "") !== draft.storyName) {
          patch.storyName = draft.storyName;
        }
        if (task.storyLink !== draft.storyLink) {
          patch.storyLink = draft.storyLink;
        }
        if (Object.keys(patch).length > 0) {
          updateTask(task.id, patch);
        }
      }
      if (close) {
        setStoryFieldsOpen(null);
      }
    },
    [storyFieldsOpen, updateTask],
  );

  useEffect(() => {
    if (!storyFieldsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (storyFieldsMenuRef.current?.contains(target)) {
        return;
      }
      if (storyFieldsOpen.trigger?.isConnected && storyFieldsOpen.trigger.contains(target)) {
        return;
      }
      commitOpenStoryFields(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStoryFieldsOpen(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [storyFieldsOpen, commitOpenStoryFields]);

  useEffect(() => {
    if (!storyFieldsOpen?.trigger) {
      return;
    }
    const updatePosition = () => {
      const trigger = storyFieldsOpen.trigger;
      if (!trigger?.isConnected) {
        setStoryFieldsOpen(null);
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 220), Math.min(248, window.innerWidth - 16));
      const menuHeight = storyFieldsMenuRef.current?.offsetHeight || 160;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const placeBelow = spaceBelow >= 96 || spaceBelow >= spaceAbove;
      const top = placeBelow
        ? rect.bottom + 2
        : Math.max(8, rect.top - Math.min(menuHeight, spaceAbove) - 2);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      setStoryFieldsMenuPos({ top, left, width });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [storyFieldsOpen]);

  useEffect(() => {
    if (!isBulkStoryMenuOpen || !bulkStoryButtonRef.current) {
      return;
    }
    const updatePosition = () => {
      const rect = bulkStoryButtonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const menuWidth = 248;
      const menuHeight = 340;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const top =
        spaceBelow >= menuHeight ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4);
      setBulkStoryMenuPos({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isBulkStoryMenuOpen]);

  const positionAssigneePicker = (trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, 152),
      Math.min(220, Math.max(152, window.innerWidth - 16)),
    );
    const gap = 2;
    const viewportPad = 8;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
    const spaceAbove = rect.top - viewportPad;
    const placeBelow = spaceBelow >= 96 || spaceBelow >= spaceAbove;
    const available = placeBelow ? spaceBelow : spaceAbove;
    const maxHeight = Math.max(72, Math.min(280, available));
    const left = Math.min(Math.max(viewportPad, rect.left), window.innerWidth - width - viewportPad);

    // Anchor above with `bottom` so short menus sit against the trigger (not maxHeight above it).
    if (placeBelow) {
      setAssigneePickerPos({
        top: rect.bottom + gap,
        bottom: undefined,
        left,
        width,
        maxHeight,
      });
      return;
    }
    setAssigneePickerPos({
      top: undefined,
      bottom: window.innerHeight - rect.top + gap,
      left,
      width,
      maxHeight,
    });
  };

  const toggleAssigneePicker = (
    taskId: string,
    kind: AssigneePickerKind,
    trigger: HTMLElement,
  ) => {
    setStoryFieldsOpen(null);
    setMobileOptionsOpen(null);
    if (assigneePickerOpen?.taskId === taskId && assigneePickerOpen?.kind === kind) {
      setAssigneePickerOpen(null);
      return;
    }
    positionAssigneePicker(trigger);
    setAssigneePickerOpen({ taskId, kind, trigger });
  };

  const renderTablePickerPortal = (
    taskId: string,
    kind: AssigneePickerKind,
    content: ReactNode,
    options?: { multiselectable?: boolean; ariaLabel?: string; statusPanel?: boolean },
  ) => {
    if (!assigneePickerOpen || assigneePickerOpen.taskId !== taskId || assigneePickerOpen.kind !== kind) {
      return null;
    }
    if (typeof document === "undefined") {
      return null;
    }
    return createPortal(
      <div
        ref={assigneePickerRef}
        className={
          options?.statusPanel
            ? "task-status-picker-panel task-status-picker-panel-portal"
            : "assignee-picker-panel assignee-picker-panel-portal"
        }
        role="listbox"
        aria-multiselectable={options?.multiselectable ? true : undefined}
        aria-label={options?.ariaLabel}
        style={{
          position: "fixed",
          top: assigneePickerPos.top,
          bottom: assigneePickerPos.bottom,
          left: assigneePickerPos.left,
          width: assigneePickerPos.width,
          maxHeight: assigneePickerPos.maxHeight,
          zIndex: 1000,
        }}
      >
        {content}
      </div>,
      document.body,
    );
  };

  const getTaskForJiraSync = (taskId: string): Task | null => {
    const fresh = usePlannerStore.getState().tasks.find((item) => item.id === taskId);
    if (!fresh) {
      return null;
    }
    return resolveTaskForJiraSync(fresh, linkInputsRef.current[taskId]?.value);
  };

  const plannerPeopleForJira = () => peopleFromResources(resources);

  const storyLabelForSync = (task: Task) => task.storyName.trim() || task.storyLink.trim() || task.id;

  const closeBulkStoryMenu = () => {
    setIsBulkStoryMenuOpen(false);
  };

  /** Close the Actions menu first so the UI unlocks before confirms / long work. */
  const runAfterBulkMenuClose = (action: () => void | Promise<void>) => {
    closeBulkStoryMenu();
    window.setTimeout(() => {
      void action();
    }, 0);
  };

  const bulkSyncToJira = () => {
    runAfterBulkMenuClose(async () => {
      if (!activeSquadId) {
        window.alert("Select a squad before syncing to Jira.");
        return;
      }

      const selectedRows = orderedTasks.filter((task) => selectedTaskIdSet.has(task.id));
      const selectedTasksForSync = selectedRows
        .map((row) => getTaskForJiraSync(row.id))
        .filter((task): task is Task => task !== null);

      const eligibleTasks = selectedTasksForSync.filter(isTaskEligibleForJiraSync);
      const discopedTasks = selectedTasksForSync.filter((task) => isDiscopedTaskStatus(task.status));

      if (selectedTasksForSync.length === 0) {
        window.alert("Select one or more stories to push to Jira.");
        return;
      }
      if (eligibleTasks.length === 0) {
        window.alert(
          discopedTasks.length > 0
            ? "Discoped stories are not synced to Jira."
            : "No selected stories with a Jira link and hours to sync.",
        );
        return;
      }
      if (
        !window.confirm(
          formatBulkSyncConfirmMessage(
            eligibleTasks.length,
            selectedTasksForSync.length,
            discopedTasks.length,
          ),
        )
      ) {
        return;
      }

      startJiraSync({
        mode: "push",
        tasks: eligibleTasks.map((task) => ({ taskId: task.id, storyName: storyLabelForSync(task) })),
      });

      const results: BulkSyncTaskResult[] = [];
      let synced = 0;
      let failed = 0;

      for (const task of eligibleTasks) {
        markJiraRunning(task.id);
        try {
          const response = await fetch(`/api/integrations/jira/tasks/${encodeURIComponent(task.id)}/push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-squad-id": activeSquadId,
            },
            body: JSON.stringify({ task }),
          });
          const body = (await response.json()) as {
            error?: string;
            jira?: Task["jira"];
            warnings?: string[];
            errors?: string[];
          };
          if (!response.ok) {
            failed += 1;
            const error = body.error ?? "Sync failed";
            markJiraDone({ taskId: task.id, ok: false, error });
            results.push({
              taskId: task.id,
              storyName: storyLabelForSync(task),
              ok: false,
              error,
            });
            continue;
          }
          synced += 1;
          if (body.jira) {
            updateTask(task.id, { jira: body.jira });
          }
          markJiraDone({ taskId: task.id, ok: true });
          results.push({
            taskId: task.id,
            storyName: storyLabelForSync(task),
            ok: true,
            jira: body.jira,
            warnings: body.warnings,
            errors: body.errors,
          });
        } catch {
          failed += 1;
          markJiraDone({ taskId: task.id, ok: false, error: "Sync failed" });
          results.push({
            taskId: task.id,
            storyName: storyLabelForSync(task),
            ok: false,
            error: "Sync failed",
          });
        }
      }

      const summary = formatBulkSyncSummary({
        results,
        synced,
        failed,
        skipped: Math.max(0, selectedTasksForSync.length - eligibleTasks.length),
      });
      const hasAssigneeErrors = results.some((row) => (row.errors?.length ?? 0) > 0);
      if (synced > 0) {
        setJiraSyncPhase("saving");
        const saved = await flushPlannerStateToServer(activeSquadId);
        if (!saved) {
          finishJiraSync({
            summary: `${summary}\nWarning: changes are on screen but failed to save to the server — wait a moment before refreshing.`,
            isError: true,
          });
          return;
        }
      }
      finishJiraSync({ summary, isError: failed > 0, isWarning: bulkSyncHasPartialWarnings({ results, synced, failed, skipped: Math.max(0, selectedTasksForSync.length - eligibleTasks.length) }) || hasAssigneeErrors });
    });
  };

  const bulkPullFromJira = () => {
    runAfterBulkMenuClose(async () => {
      if (!activeSquadId) {
        window.alert("Select a squad before syncing from Jira.");
        return;
      }

      const selectedRows = orderedTasks.filter((task) => selectedTaskIdSet.has(task.id));
      const selectedTasksForSync = selectedRows
        .map((row) => getTaskForJiraSync(row.id))
        .filter((task): task is Task => task !== null);

      const eligibleTasks = selectedTasksForSync.filter(isTaskEligibleForJiraPull);
      const discopedTasks = selectedTasksForSync.filter((task) => isDiscopedTaskStatus(task.status));

      let missingStories: Array<{
        key: string;
        summary: string;
        storyLink: string;
        issueType?: string | null;
        isEmStory?: boolean;
        feHours?: number; beHours?: number; qcHours?: number; androidHours?: number; iosHours?: number;
        feDevs?: string[]; beDevs?: string[]; qcs?: string[]; androidDevs?: string[]; iosDevs?: string[];
      }> = [];
      let discoverWarning: string | null = null;
      try {
        const dashboardTasks = usePlannerStore.getState().tasks;
        const response = await fetch("/api/integrations/jira/tasks/discover-em", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-squad-id": activeSquadId,
          },
          body: JSON.stringify({
            existingStoryLinks: dashboardTasks.map((task) => task.storyLink),
            plannerResources: usePlannerStore.getState().resources.map((r) => ({
              name: r.name,
              type: r.type,
            })),
          }),
        });
        const body = (await response.json()) as {
          error?: string;
          stories?: Array<{
            key: string;
            summary: string;
            storyLink: string;
            issueType?: string | null;
            isEmStory?: boolean;
            feHours?: number;
            beHours?: number;
            qcHours?: number;
            androidHours?: number;
            iosHours?: number;
            feDevs?: string[];
            beDevs?: string[];
            qcs?: string[];
            androidDevs?: string[];
            iosDevs?: string[];
          }>;
          warning?: string | null;
          truncated?: boolean;
        };
        if (!response.ok) {
          if (eligibleTasks.length === 0) {
            window.alert(body.error ?? "Failed to search Jira for EM stories.");
            return;
          }
          discoverWarning = body.error ?? "Could not search Jira for missing EM stories.";
        } else {
          missingStories = body.stories ?? [];
          discoverWarning = body.warning ?? null;
          if (body.truncated) {
            discoverWarning = [discoverWarning, "Jira returned more than 200 matching stories — imported the first 200."]
              .filter(Boolean)
              .join(" ");
          }
        }
      } catch {
        if (eligibleTasks.length === 0) {
          window.alert("Failed to search Jira for EM stories.");
          return;
        }
        discoverWarning = "Could not search Jira for missing EM stories.";
      }

      if (eligibleTasks.length === 0 && missingStories.length === 0) {
        window.alert(
          discopedTasks.length > 0
            ? "Discoped stories are not synced from Jira."
            : discoverWarning ||
                (selectedTasksForSync.length > 0
                  ? "No selected stories with a Jira link to pull."
                  : "No Jira stories under this EM are missing from the dashboard."),
        );
        return;
      }
      if (
        !window.confirm(
          [
            formatBulkPullConfirmMessage(
              eligibleTasks.length,
              selectedTasksForSync.length,
              discopedTasks.length,
              missingStories.length,
            ),
            discoverWarning,
          ]
            .filter(Boolean)
            .join("\n\n"),
        )
      ) {
        return;
      }

      if (missingStories.length > 0) {
        if (!visibleStatuses.includes(DEFAULT_TASK_STATUS)) {
          setVisibleStatuses((current) => [...current, DEFAULT_TASK_STATUS]);
        }
        if (sprintFilter === "nextSprint") {
          setSprintFilter("currentSprint");
        }
        const newIds = addTasks(
          missingStories.map((story) => ({
            storyName: story.summary,
            storyLink: story.storyLink,
            feDevs: story.feDevs ?? [],
            beDevs: story.beDevs ?? [],
            androidDevs: story.androidDevs ?? [],
            iosDevs: story.iosDevs ?? [],
            qcs: story.qcs ?? [],
            productManagers: [],
            feHours: story.feHours ?? 0,
            beHours: story.beHours ?? 0,
            androidHours: story.androidHours ?? 0,
            iosHours: story.iosHours ?? 0,
            qcHours: story.qcHours ?? 0,
            issueType: story.issueType ?? undefined,
            isEmStory: story.isEmStory ?? false,
            tags: [JIRA_SYNC_ADDED_TAG],
            warnings: [],
            isValid: true,
          })),
        );
        if (newIds[0]) {
          setFocusTaskId(newIds[0]);
        }
      }

      const importedTasks = missingStories
        .map((story) =>
          usePlannerStore.getState().tasks.find((task) => parseJiraIssueKey(task.storyLink) === story.key),
        )
        .filter((task): task is Task => task != null && isTaskEligibleForJiraPull(task));
      const tasksToPull = [...eligibleTasks, ...importedTasks];

      startJiraSync({
        mode: "pull",
        tasks: tasksToPull.map((task) => ({ taskId: task.id, storyName: storyLabelForSync(task) })),
      });

      const results: BulkPullTaskResult[] = [];
      let synced = 0;
      let failed = 0;
      const plannerPeople = plannerPeopleForJira();

      for (const task of tasksToPull) {
        markJiraRunning(task.id);
        try {
          const response = await fetch(`/api/integrations/jira/tasks/${encodeURIComponent(task.id)}/pull`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-squad-id": activeSquadId,
            },
            body: JSON.stringify({ task, plannerPeople }),
          });
          const body = (await response.json()) as {
            error?: string;
            patch?: Partial<Task>;
            jira?: Task["jira"];
            warnings?: string[];
          };
          if (!response.ok) {
            failed += 1;
            const error = body.error ?? "Pull failed";
            markJiraDone({ taskId: task.id, ok: false, error });
            results.push({
              taskId: task.id,
              storyName: storyLabelForSync(task),
              ok: false,
              error,
            });
            continue;
          }
          synced += 1;
          if (body.patch) {
            // Hours / assignees / status changes light Need remark; jira meta alone does not.
            updateTask(task.id, body.patch);
          }
          markJiraDone({ taskId: task.id, ok: true });
          results.push({
            taskId: task.id,
            storyName: storyLabelForSync(task),
            ok: true,
            patch: body.patch,
            jira: body.jira,
            warnings: body.warnings,
          });
        } catch {
          failed += 1;
          markJiraDone({ taskId: task.id, ok: false, error: "Pull failed" });
          results.push({
            taskId: task.id,
            storyName: storyLabelForSync(task),
            ok: false,
            error: "Pull failed",
          });
        }
      }

      const importedLine =
        missingStories.length > 0
          ? `Added ${missingStories.length === 1 ? "1 story" : `${missingStories.length} stories`} from Jira that ${missingStories.length === 1 ? "was" : "were"} not on the dashboard.`
          : "";
      const summary = [importedLine, formatBulkPullSummary({
        results,
        synced,
        failed,
        skipped: Math.max(0, selectedTasksForSync.length - eligibleTasks.length),
      })]
        .filter(Boolean)
        .join("\n\n");
      if (synced > 0 || missingStories.length > 0) {
        setJiraSyncPhase("saving");
        const saved = await flushPlannerStateToServer(activeSquadId);
        if (!saved) {
          finishJiraSync({
            summary: `${summary}\nWarning: pull results are on screen but failed to save to the server — wait a moment before refreshing.`,
            isError: true,
          });
          return;
        }
      }
      finishJiraSync({
        summary,
        isError: failed > 0,
        isWarning:
          failed === 0 &&
          (Boolean(discoverWarning) || results.some((row) => (row.warnings?.length ?? 0) > 0)),
      });
    });
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- sort depends on live schedule map
  const orderedTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const statusVisible = visibleStatuses.some(
        (status) => status.trim().toLowerCase() === task.status.trim().toLowerCase(),
      );
      if (!statusVisible) return false;
      if (sprintFilter === "nextSprint") return !!task.carryToNextSprint;
      if (sprintFilter === "currentSprint") return !task.carryToNextSprint;
      return true;
    }).filter((task) => {
      if (emFilter === "em" && !task.isEmStory) return false;
      if (emFilter === "non-em" && task.isEmStory) return false;
      if (!taskMatchesIssueTypeFilter(task, typeFilter)) return false;
      if (kindFilter === "standalone" && !isParentlessPlannerTask(task)) return false;
      if (kindFilter === "stories" && isParentlessPlannerTask(task)) return false;
      return true;
    });
    const releaseDateById = new Map(
      safeResult.tasks.map((item) => [item.id, item.releaseDate] as const),
    );
    const pinnedOrder =
      isUatTrackingEnabled && plannerMeta.dashboardTaskOrder.length > 0
        ? plannerMeta.dashboardTaskOrder
        : null;
    return sortTasksForDashboard(filtered, releaseDateById, pinnedOrder);
  }, [tasks, safeResult.tasks, visibleStatuses, sprintFilter, emFilter, typeFilter, kindFilter, isUatTrackingEnabled, plannerMeta.dashboardTaskOrder]);

  useEffect(() => {
    if (!focusTaskId) return;
    if (!orderedTasks.some((task) => task.id === focusTaskId)) return;
    const row = tableScrollRef.current?.querySelector(`[data-task-id="${CSS.escape(focusTaskId)}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
    }
    const timer = window.setTimeout(() => setFocusTaskId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusTaskId, orderedTasks]);

  const releaseGroupColorMap = useMemo(
    () => buildReleaseGroupColorMap(orderedTasks.map((task) => task.releaseGroup)),
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- orderedTasks is derived each render
    [orderedTasks],
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- Set identity for selection checks
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const expandedJiraTaskIdSet = useMemo(() => new Set(expandedJiraTaskIds), [expandedJiraTaskIds]);
  const visibleSelectedCount = useMemo(
    () => orderedTasks.filter((task) => selectedTaskIdSet.has(task.id)).length,
    [orderedTasks, selectedTaskIdSet],
  );
  const selectedTasks = useMemo(
    () => orderedTasks.filter((task) => selectedTaskIdSet.has(task.id)),
    [orderedTasks, selectedTaskIdSet],
  );
  const selectedJiraPushEligibleCount = useMemo(
    () => selectedTasks.filter((task) => isTaskEligibleForJiraSync(task)).length,
    [selectedTasks],
  );

  const jiraSyncInProgress = jiraSyncActive;
  const allVisibleSelected =
    orderedTasks.length > 0 && visibleSelectedCount === orderedTasks.length;

  useEffect(() => {
    const visibleIds = new Set(orderedTasks.map((task) => task.id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prune selection when filters hide rows
    setSelectedTaskIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [orderedTasks]);

  const toggleTaskSelected = (taskId: string) => {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  };

  const selectAllVisibleTasks = () => {
    setSelectedTaskIds(orderedTasks.map((task) => task.id));
  };

  const clearTaskSelection = () => {
    setSelectedTaskIds([]);
    setIsBulkStoryMenuOpen(false);
  };

  const toggleJiraExpanded = (taskId: string) => {
    setExpandedJiraTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
    );
  };

  const positionMobileOptions = (trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(280, rect.width), Math.min(320, window.innerWidth - 16));
    const top = Math.min(rect.bottom + 4, window.innerHeight - 140);
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    setMobileOptionsPos({ top, left, width });
  };

  const toggleMobileOptions = (taskId: string, trigger: HTMLElement) => {
    setAssigneePickerOpen(null);
    setStoryFieldsOpen(null);
    if (mobileOptionsOpen?.taskId === taskId) {
      setMobileOptionsOpen(null);
      return;
    }
    positionMobileOptions(trigger);
    setMobileOptionsOpen({ taskId, trigger });
  };

  const expandJiraForSelected = () => {
    closeBulkStoryMenu();
    const ids = orderedTasks.filter((task) => selectedTaskIdSet.has(task.id)).map((task) => task.id);
    setExpandedJiraTaskIds((current) => [...new Set([...current, ...ids])]);
  };

  const hideJiraForSelected = () => {
    closeBulkStoryMenu();
    const ids = new Set(
      orderedTasks.filter((task) => selectedTaskIdSet.has(task.id)).map((task) => task.id),
    );
    setExpandedJiraTaskIds((current) => current.filter((id) => !ids.has(id)));
  };

  const selectedJiraUpdatesVisible =
    visibleSelectedCount > 0 &&
    orderedTasks
      .filter((task) => selectedTaskIdSet.has(task.id))
      .every((task) => expandedJiraTaskIdSet.has(task.id));

  const selectedAnyOnNextSprint = selectedTasks.some((task) => !!task.carryToNextSprint);
  const selectedAnyOnCurrentSprint = selectedTasks.some((task) => !task.carryToNextSprint);

  const moveSelectedToNextSprint = () => {
    if (!canManageSprintLifecycle) return;
    closeBulkStoryMenu();
    const targets = selectedTasks.filter((task) => !task.carryToNextSprint);
    if (targets.length === 0) {
      return;
    }
    updateTasks(
      targets.map((task) => task.id),
      { carryToNextSprint: true },
    );
    setSprintFilter("nextSprint");
    setActionFeedback(
      targets.length === 1
        ? "1 story moved to Next sprint — switched to the Next sprint view."
        : `${targets.length} stories moved to Next sprint — switched to the Next sprint view.`,
    );
  };

  const moveSelectedToCurrentSprint = () => {
    if (!canManageSprintLifecycle) return;
    closeBulkStoryMenu();
    const targets = selectedTasks.filter((task) => !!task.carryToNextSprint);
    if (targets.length === 0) {
      return;
    }
    updateTasks(
      targets.map((task) => task.id),
      { carryToNextSprint: false },
    );
    setSprintFilter("currentSprint");
    setActionFeedback(
      targets.length === 1
        ? "1 story moved to Current sprint — switched to the Current sprint view."
        : `${targets.length} stories moved to Current sprint — switched to the Current sprint view.`,
    );
  };

  const toggleJiraUpdatesForSelected = () => {
    if (selectedJiraUpdatesVisible) {
      hideJiraForSelected();
    } else {
      expandJiraForSelected();
    }
  };

  const setBufferHoursForSelected = () => {
    if (!canManageSprintLifecycle) return;
    runAfterBulkMenuClose(() => {
      const ids = selectedTasks.map((task) => task.id);
      if (ids.length === 0) {
        return;
      }
      const raw = window.prompt(
        `Set buffer hours for ${ids.length} selected ${ids.length === 1 ? "story" : "stories"}`,
        "0",
      );
      if (raw == null) {
        return;
      }
      const next = clampHours(Number(raw));
      updateTasks(ids, { bufferHours: next });
      setActionFeedback(
        ids.length === 1
          ? `Buffer set to ${next}h for 1 story.`
          : `Buffer set to ${next}h for ${ids.length} stories.`,
      );
    });
  };

  const copyStoryLinksForSelected = () => {
    runAfterBulkMenuClose(async () => {
      if (selectedTasks.length === 0) {
        return;
      }
      try {
        await copySelectedStoriesToClipboard(
          selectedTasks.map((task) => ({
            storyName: task.storyName,
            storyLink: task.storyLink,
          })),
        );
        setActionFeedback(
          selectedTasks.length === 1
            ? "Copied 1 story link."
            : `Copied ${selectedTasks.length} story links.`,
        );
      } catch {
        setActionFeedback("Could not copy story links.");
      }
    });
  };

  const addTagForSelected = () => {
    runAfterBulkMenuClose(() => {
      if (selectedTasks.length === 0) {
        return;
      }
      if (selectedTasks.length === 1) {
        setTagInputDraft("");
        setTaskTagModalId(selectedTasks[0].id);
        return;
      }
      const raw = window.prompt(`Add a tag to ${selectedTasks.length} selected stories`);
      if (raw == null) {
        return;
      }
      const tag = raw.trim();
      if (!tag) {
        return;
      }
      selectedTasks.forEach((task) => {
        const existing = task.tags ?? [];
        if (existing.some((item) => item.toLowerCase() === tag.toLowerCase())) {
          return;
        }
        updateTask(task.id, { tags: [...existing, tag] });
      });
      setActionFeedback(`Tag "${tag}" added to selected stories.`);
    });
  };

  const addTodoForSelected = () => {
    runAfterBulkMenuClose(() => {
      if (selectedTasks.length === 0) {
        return;
      }
      if (selectedTasks.length === 1) {
        setTodoModalDraft(selectedTasks[0].taskNotes ?? "");
        setTaskTodoModalId(selectedTasks[0].id);
        return;
      }
      const raw = window.prompt(`Add todo line(s) to ${selectedTasks.length} selected stories`);
      if (raw == null) {
        return;
      }
      const addition = raw.trim();
      if (!addition) {
        return;
      }
      selectedTasks.forEach((task) => {
        const current = (task.taskNotes ?? "").trim();
        updateTask(task.id, { taskNotes: current ? `${current}\n${addition}` : addition });
      });
      setActionFeedback(`Todo added to ${selectedTasks.length} selected stories.`);
    });
  };

  const removeSelectedTasks = () => {
    runAfterBulkMenuClose(() => {
      if (selectedTasks.length === 0) {
        return;
      }
      if (selectedTasks.length === 1) {
        setTaskPendingDelete(selectedTasks[0].id);
        return;
      }
      if (
        !window.confirm(
          `Remove ${selectedTasks.length} selected stories from the planner? This cannot be undone.`,
        )
      ) {
        return;
      }
      selectedTasks.forEach((task) => removeTask(task.id));
      setSelectedTaskIds([]);
      setActionFeedback(`${selectedTasks.length} stories removed.`);
    });
  };

  const totalStoryCount = tasks.length;
  const visibleStoryCount = orderedTasks.length;

  const toggleVisibleStatus = (status: string) => {
    setVisibleStatuses((current) => {
      if (current.includes(status)) {
        return current.filter((item) => item !== status);
      }
      return [...current, status];
    });
  };

  const importTasksFromFile = async (file: File) => {
    setIsImportingTasks(true);
    try {
      const result = await parseTasksImportFile(file, resources);
      if (result.error) {
        window.alert(result.error);
        return;
      }
      const validRows = result.rows.filter((row) => row.isValid);
      if (validRows.length === 0) {
        window.alert("No valid stories found in the file. Check the template columns and try again.");
        return;
      }
      addTasks(validRows);
      const warningCount = validRows.filter((row) => row.warnings.length > 0).length;
      setActionFeedback(
        warningCount > 0
          ? `Imported ${validRows.length} ${validRows.length === 1 ? "story" : "stories"} (${warningCount} with assignee warnings).`
          : `Imported ${validRows.length} ${validRows.length === 1 ? "story" : "stories"}.`,
      );
    } finally {
      setIsImportingTasks(false);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    }
  };

  const updateIntegrationFlags = (
    task: Task,
    patch: Partial<NonNullable<Task["integrationFlags"]>>,
  ) => {
    updateTask(task.id, {
      integrationFlags: {
        needsDevOps: task.integrationFlags?.needsDevOps ?? false,
        needsCdc: task.integrationFlags?.needsCdc ?? false,
        needsDbSync: task.integrationFlags?.needsDbSync ?? false,
        needsOtherSquad: task.integrationFlags?.needsOtherSquad ?? false,
        needsThirdParty: task.integrationFlags?.needsThirdParty ?? false,
        ...patch,
      },
    });
  };

  const storyFieldsTask = storyFieldsOpen
    ? tasks.find((item) => item.id === storyFieldsOpen.taskId)
    : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Tasks</h2>
        <div className="task-table-toolbar">
          <div className="task-table-toolbar-filters">
            <span className="task-table-toolbar-group-label">Filters</span>
            <div className="relative" ref={sprintFilterRef}>
              <button
                type="button"
                className={toolbarTriggerClass(isSprintFilterOpen || sprintFilter !== "currentSprint")}
                aria-expanded={isSprintFilterOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  if (!isSprintFilterOpen) closeOtherFilterMenus("sprint");
                  setIsSprintFilterOpen((current) => !current);
                }}
              >
                <span>Sprint</span>
                <ToolbarMenuChevron open={isSprintFilterOpen} />
                <span className="toolbar-strip-btn-value capitalize">{sprintFilterSummary}</span>
              </button>
              {isSprintFilterOpen ? (
                <div className="toolbar-dropdown-shell absolute left-0 z-20 mt-2 w-[min(100vw-1.5rem,15rem)]">
                  <ToolbarDropdownHeader
                    title="Sprint"
                    subtitle="Choose which sprint window to show in the table."
                  />
                  <div className="space-y-1 px-2 py-2">
                    {(["currentSprint", "nextSprint", "all"] as const).map((option) => {
                      const on = sprintFilter === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          className={`toolbar-menu-item ${on ? "toolbar-menu-item-active" : ""}`}
                          onClick={() => {
                            setSprintFilter(option);
                            setIsSprintFilterOpen(false);
                          }}
                        >
                          {option === "currentSprint"
                            ? "Current sprint"
                            : option === "nextSprint"
                              ? "Next sprint"
                              : "All sprints"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={statusFilterRef}>
              <button
                type="button"
                className={toolbarTriggerClass(isStatusFilterOpen || isStatusFilterCustom)}
                aria-expanded={isStatusFilterOpen}
                aria-haspopup="true"
                onClick={() => {
                  if (!isStatusFilterOpen) closeOtherFilterMenus("status");
                  setIsStatusFilterOpen((current) => !current);
                }}
              >
                <span>Status</span>
                <ToolbarMenuChevron open={isStatusFilterOpen} />
                <span className="toolbar-strip-btn-value tabular-nums">
                  {visibleStatuses.length}/{statusFilterOptions.length}
                </span>
              </button>
              {isStatusFilterOpen ? (
                <div
                  className="toolbar-dropdown-shell absolute left-0 z-20 mt-2 w-[min(100vw-1.5rem,16.5rem)]"
                  aria-label="Filter tasks by status"
                >
                  <ToolbarDropdownHeader
                    title="Status"
                    subtitle={`${visibleStatuses.length} of ${statusFilterOptions.length} statuses visible in the table.`}
                  />
                  <div className="max-h-[min(18rem,calc(100vh-12rem))] space-y-1 overflow-y-auto px-2 py-2">
                    {statusFilterOptions.map((status) => {
                      const on = visibleStatuses.some(
                        (item) => item.trim().toLowerCase() === status.trim().toLowerCase(),
                      );
                      return (
                        <label
                          key={status}
                          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border-l-4 py-2 pl-2.5 pr-2 text-[13px] font-semibold shadow-sm transition ${statusFilterClass(status)} ${
                            on ? "ring-1 ring-slate-300/90 ring-offset-0" : "opacity-[0.72] hover:opacity-100"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleVisibleStatus(status)}
                          />
                          <span className="min-w-0 flex-1 leading-snug">{status}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="toolbar-dropdown-footer">
                    <button
                      type="button"
                      className="toolbar-dropdown-footer-btn"
                      onClick={() => {
                        setVisibleStatuses([...statusFilterOptions]);
                        setIsStatusFilterOpen(false);
                      }}
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      className="toolbar-dropdown-footer-btn"
                      onClick={() => {
                        setVisibleStatuses(defaultVisibleStatusOptions);
                        setIsStatusFilterOpen(false);
                      }}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className="toolbar-dropdown-footer-btn"
                      onClick={() => {
                        setVisibleStatuses([]);
                        setIsStatusFilterOpen(false);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={typeFilterRef}>
              <button
                type="button"
                className={toolbarTriggerClass(typeFilterOpen || typeFilter.length > 0)}
                aria-expanded={typeFilterOpen}
                onClick={() => {
                  if (!typeFilterOpen) closeOtherFilterMenus("type");
                  setTypeFilterOpen((value) => !value);
                }}
              >
                <span>Type</span>
                <ToolbarMenuChevron open={typeFilterOpen} />
                {typeFilter.length > 0 ? (
                  <span className="toolbar-strip-btn-value tabular-nums">{typeFilter.length} selected</span>
                ) : null}
              </button>
              {typeFilterOpen ? (() => {
                const allTypes = buildIssueTypeFilterOptions(tasks.map((t) => t.issueType));
                return (
                  <div
                    className="toolbar-dropdown-shell absolute left-0 z-20 mt-2 w-[min(100vw-1.5rem,15rem)]"
                    aria-label="Filter tasks by type"
                  >
                    <ToolbarDropdownHeader
                      title="Issue type"
                      subtitle="Show only matching issue types. Rows without a type count as Story."
                    />
                    <div className="max-h-[min(14rem,calc(100vh-12rem))] space-y-1 overflow-y-auto px-2 py-2">
                      {allTypes.map((type) => {
                        const on = typeFilter.includes(type);
                        return (
                          <label
                            key={type}
                            className={`toolbar-menu-choice ${on ? "toolbar-menu-choice-on" : ""}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={on}
                              onChange={() =>
                                setTypeFilter((prev) =>
                                  on ? prev.filter((t) => t !== type) : [...prev, type],
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 font-semibold leading-snug text-slate-900">{type}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="toolbar-dropdown-footer">
                      <button
                        type="button"
                        className="toolbar-dropdown-footer-btn"
                        onClick={() => {
                          setTypeFilter([]);
                          setTypeFilterOpen(false);
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                );
              })() : null}
            </div>
            <div className="relative" ref={ownerFilterRef}>
              <button
                type="button"
                className={toolbarTriggerClass(ownerFilterOpen || emFilter !== "all")}
                aria-expanded={ownerFilterOpen}
                aria-haspopup="true"
                title={ownerFilterSummary ? `Owner: ${ownerFilterSummary}` : "Filter by EM or team"}
                onClick={() => {
                  if (!ownerFilterOpen) closeOtherFilterMenus("owner");
                  setOwnerFilterOpen((value) => !value);
                }}
              >
                <span>Owner</span>
                <ToolbarMenuChevron open={ownerFilterOpen} />
                {ownerFilterSummary ? (
                  <span className="toolbar-strip-btn-value">{ownerFilterSummary}</span>
                ) : null}
              </button>
              {ownerFilterOpen ? (
                <div
                  className="toolbar-dropdown-shell absolute left-0 z-20 mt-2 w-[min(100vw-1.5rem,16rem)]"
                  aria-label="Filter by owner"
                >
                  <ToolbarDropdownHeader title="Owner" subtitle="Who owns the work on this squad." />
                  <div className="space-y-1 px-2 py-2">
                    {(
                      [
                        { value: "all" as const, label: "All", hint: "EM and team" },
                        { value: "em" as const, label: "EM", hint: "Assigned to this squad’s EM" },
                        { value: "non-em" as const, label: "Team", hint: "Not assigned to the EM" },
                      ] as const
                    ).map((option) => {
                      const on = emFilter === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`toolbar-menu-choice ${on ? "toolbar-menu-choice-on" : ""}`}
                        >
                          <input
                            type="radio"
                            name="story-owner-filter"
                            className="mt-0.5"
                            checked={on}
                            onChange={() => setEmFilter(option.value)}
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-slate-900">{option.label}</span>
                            <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                              {option.hint}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="toolbar-dropdown-footer">
                    <button
                      type="button"
                      className="toolbar-dropdown-footer-btn"
                      onClick={() => {
                        setEmFilter("all");
                        setOwnerFilterOpen(false);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={kindFilterRef}>
              <button
                type="button"
                className={toolbarTriggerClass(kindFilterOpen || kindFilter !== "all")}
                aria-expanded={kindFilterOpen}
                aria-haspopup="true"
                title={kindFilterSummary ? `Kind: ${kindFilterSummary}` : "Filter stories vs standalone items"}
                onClick={() => {
                  if (!kindFilterOpen) closeOtherFilterMenus("kind");
                  setKindFilterOpen((value) => !value);
                }}
              >
                <span>Kind</span>
                <ToolbarMenuChevron open={kindFilterOpen} />
                {kindFilterSummary ? (
                  <span className="toolbar-strip-btn-value">{kindFilterSummary}</span>
                ) : null}
              </button>
              {kindFilterOpen ? (
                <div
                  className="toolbar-dropdown-shell absolute left-0 z-20 mt-2 w-[min(100vw-1.5rem,16rem)]"
                  aria-label="Filter by kind"
                >
                  <ToolbarDropdownHeader title="Kind" subtitle="Stories versus standalone Jira items." />
                  <div className="space-y-1 px-2 py-2">
                    {(
                      [
                        { value: "all" as const, label: "All", hint: "Stories and standalone" },
                        { value: "stories" as const, label: "Stories", hint: "Jira stories" },
                        {
                          value: "standalone" as const,
                          label: "Standalone",
                          hint: "Bugs, tasks, and items with no parent story",
                        },
                      ] as const
                    ).map((option) => {
                      const on = kindFilter === option.value;
                      return (
                        <label
                          key={option.value}
                          className={`toolbar-menu-choice ${on ? "toolbar-menu-choice-on" : ""}`}
                        >
                          <input
                            type="radio"
                            name="story-kind-filter"
                            className="mt-0.5"
                            checked={on}
                            onChange={() => setKindFilter(option.value)}
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-slate-900">{option.label}</span>
                            <span className="mt-0.5 block text-[11px] font-normal leading-snug text-slate-500">
                              {option.hint}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="toolbar-dropdown-footer">
                    <button
                      type="button"
                      className="toolbar-dropdown-footer-btn"
                      onClick={() => {
                        setKindFilter("all");
                        setKindFilterOpen(false);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="task-table-toolbar-divider" aria-hidden />
          <div className="task-table-toolbar-actions">
            <span className="task-table-toolbar-group-label">Actions</span>
            {canManageSprintLifecycle ? (
              <button
                type="button"
                className={toolbarTriggerClass(
                  false,
                  pendingMarkProgressIds.size > 0 ? "toolbar-strip-btn-needs-progress" : "",
                )}
                disabled={isMarkingProgress || jiraSyncInProgress}
                aria-busy={isMarkingProgress}
                title={markProgressHoverHint}
                onClick={() => {
                  setTasksMenuOpen(false);
                  if (
                    !window.confirm(
                      isUatTrackingEnabled
                        ? "Mark progress from now? UAT and production dates will replan from the current time."
                        : "Start release tracking? UAT and production dates will be tracked from the current schedule.",
                    )
                  ) {
                    return;
                  }
                  setIsMarkingProgress(true);
                  try {
                    markProgressNow();
                    setActionFeedback("Marked progress — Cur UAT/Production dates refreshed.");
                  } finally {
                    window.setTimeout(() => setIsMarkingProgress(false), 250);
                  }
                }}
              >
                <span>{isMarkingProgress ? "Marking…" : "Mark Progress Now"}</span>
                {!isMarkingProgress && pendingMarkProgressIds.size > 0 ? (
                  <span className="toolbar-strip-btn-badge">{pendingMarkProgressIds.size}</span>
                ) : null}
              </button>
            ) : null}
            <div className="relative" ref={tasksMenuRef}>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void importTasksFromFile(file);
                  }
                }}
              />
              <button
                type="button"
                className={toolbarTriggerClass(tasksMenuOpen)}
                aria-expanded={tasksMenuOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setIsSprintFilterOpen(false);
                  setIsStatusFilterOpen(false);
                  setTypeFilterOpen(false);
                  setOwnerFilterOpen(false);
                  setKindFilterOpen(false);
                  setTasksMenuOpen((value) => !value);
                }}
              >
                <span>Tasks</span>
                <ToolbarMenuChevron open={tasksMenuOpen} />
              </button>
              {tasksMenuOpen ? (
                <div
                  className="toolbar-dropdown-shell absolute right-0 z-20 mt-2 w-[min(100vw-1.5rem,15rem)]"
                  role="menu"
                  aria-label="Add or import tasks"
                >
                  <ToolbarDropdownHeader
                    title="Tasks"
                    subtitle="Create one task, paste many, or import a spreadsheet."
                  />
                  <div className="space-y-1 px-2 py-2">
                    {isEditor ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="toolbar-menu-item"
                        onClick={handleAddTask}
                      >
                        Add singular task
                      </button>
                    ) : null}
                    {isEditor ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="toolbar-menu-item"
                        disabled={isImportingTasks}
                        onClick={() => {
                          setTasksMenuOpen(false);
                          importFileInputRef.current?.click();
                        }}
                      >
                        {isImportingTasks ? "Importing…" : "Import from file"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="toolbar-menu-item"
                      disabled={isDownloadingTemplate}
                      aria-busy={isDownloadingTemplate}
                      title="Download XLSX template for task import"
                      onClick={() => {
                        setTasksMenuOpen(false);
                        setIsDownloadingTemplate(true);
                        void downloadTasksImportTemplate(resources)
                          .then(() => setActionFeedback("Template downloaded."))
                          .catch(() => setActionFeedback("Template download failed."))
                          .finally(() => setIsDownloadingTemplate(false));
                      }}
                    >
                      {isDownloadingTemplate ? "Downloading…" : "Download template"}
                    </button>
                    {isEditor ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="toolbar-menu-item"
                        onClick={() => {
                          setTasksMenuOpen(false);
                          setIsBulkAddOpen(true);
                        }}
                      >
                        Bulk insertion
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-300 bg-blue-100/80 px-3 py-2 text-sm font-medium text-blue-900">
        <span className="min-w-0">
          {hasHydrated ? (
            <>
              Sprint start {format(parseCalendarDate(config.sprintStartDate), "EEE dd MMM, yyyy")}
              <span className="mx-1.5 text-blue-800/70">·</span>
              Window ends {format(getSprintWindowEnd(config), "EEE dd MMM, yyyy")}
            </>
          ) : (
            <>Sprint window</>
          )}
        </span>
        <span className="text-right font-semibold text-blue-950">
          Stories: <span className="tabular-nums">{totalStoryCount}</span> total
          {visibleStoryCount !== totalStoryCount ? (
            <span className="ml-2 font-normal text-blue-900/80">
              · <span className="font-medium tabular-nums text-blue-950">{visibleStoryCount}</span> shown
            </span>
          ) : null}
        </span>
      </div>
      <JiraSyncBanner />
      {actionFeedback ? (
        <div className="task-action-feedback" role="status" aria-live="polite">
          <span className="min-w-0">{actionFeedback}</span>
          <button
            type="button"
            className="task-action-feedback-dismiss"
            aria-label="Dismiss"
            onClick={() => setActionFeedback(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      <div ref={tableScrollRef} className="table-shell task-table-scroll">
        <table className="task-table-fit text-[13px]">
          <thead className="table-head">
              <tr>
              <th className="story-select-col text-center align-middle" title="Select stories, set PO schedule order (Ord), and release group (Grp)">
                  {isEditor ? (
                  <div className="story-header-select story-header-select-stack" ref={bulkStoryMenuRef}>
                    <button
                      type="button"
                      className={`story-header-select-all-btn${
                        allVisibleSelected && orderedTasks.length > 0
                          ? " story-header-select-all-btn-on"
                          : visibleSelectedCount > 0
                            ? " story-header-select-all-btn-partial"
                            : ""
                      }`}
                      disabled={orderedTasks.length === 0}
                      title={
                        allVisibleSelected
                          ? "Clear all visible stories"
                          : `Select all visible stories (${orderedTasks.length})`
                      }
                      aria-pressed={allVisibleSelected && orderedTasks.length > 0}
                      onClick={() => {
                        if (allVisibleSelected) {
                          clearTaskSelection();
                        } else {
                          selectAllVisibleTasks();
                        }
                      }}
                    >
                      <span className="story-header-select-all-check" aria-hidden>
                        {allVisibleSelected && orderedTasks.length > 0
                          ? "☑"
                          : visibleSelectedCount > 0
                            ? "▣"
                            : "☐"}
                      </span>
                      <span className="story-header-select-all-label">
                        {allVisibleSelected && orderedTasks.length > 0
                          ? "All on"
                          : visibleSelectedCount > 0
                            ? `${visibleSelectedCount}`
                            : "All"}
                      </span>
                    </button>
                    <button
                      ref={bulkStoryButtonRef}
                      type="button"
                      className={`story-header-act-btn${isBulkStoryMenuOpen ? " story-header-act-btn-open" : ""}${jiraSyncInProgress ? " story-header-act-btn-busy" : ""}`}
                      aria-expanded={isBulkStoryMenuOpen}
                      aria-haspopup="menu"
                      aria-busy={jiraSyncInProgress}
                      aria-label="Bulk story actions"
                      disabled={jiraSyncInProgress}
                      title={
                        jiraSyncInProgress
                          ? jiraSyncPhase === "saving"
                            ? "Saving planner after Jira sync…"
                            : jiraSyncMode === "pull"
                              ? "Pulling from Jira…"
                              : "Pushing to Jira…"
                          : visibleSelectedCount > 0
                            ? `Actions for ${visibleSelectedCount} selected ${visibleSelectedCount === 1 ? "story" : "stories"}`
                            : "Select stories, then open actions"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        if (jiraSyncInProgress) return;
                        setIsSprintFilterOpen(false);
                        setIsStatusFilterOpen(false);
                        setStoryFieldsOpen(null);
                        setIsBulkStoryMenuOpen((open) => !open);
                      }}
                    >
                      <span>
                        {jiraSyncInProgress
                          ? jiraSyncPhase === "saving"
                            ? "Saving…"
                            : jiraSyncMode === "pull"
                              ? "Pulling…"
                              : "Pushing…"
                          : "Actions"}
                      </span>
                      <span className="story-header-act-chevron" aria-hidden>
                        {jiraSyncInProgress ? "…" : isBulkStoryMenuOpen ? "▴" : "▾"}
                      </span>
                    </button>
                    {isBulkStoryMenuOpen && typeof document !== "undefined"
                      ? createPortal(
                          <div
                            ref={bulkStoryMenuPanelRef}
                            className="toolbar-dropdown-shell w-[15.5rem] text-left normal-case tracking-normal shadow-xl"
                            role="menu"
                            style={{
                              position: "fixed",
                              top: bulkStoryMenuPos.top,
                              left: bulkStoryMenuPos.left,
                              zIndex: 1000,
                            }}
                          >
                            <div className="space-y-0.5 p-1.5">
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0 || jiraSyncInProgress || selectedJiraPushEligibleCount === 0}
                                title={
                                  visibleSelectedCount === 0
                                    ? "Select stories first"
                                    : selectedJiraPushEligibleCount === 0
                                      ? "No selected stories with a Jira link and hours to push"
                                      : `Push ${selectedJiraPushEligibleCount} selected ${selectedJiraPushEligibleCount === 1 ? "story" : "stories"} to Jira`
                                }
                                onClick={bulkSyncToJira}
                              >
                                <span className="jira-sync-glyph jira-sync-glyph-push" aria-hidden>
                                  ↑
                                </span>
                                Push to Jira
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-sky-900 hover:bg-sky-50 disabled:opacity-45"
                                disabled={jiraSyncInProgress}
                                title="Pull selected stories and add this EM’s current-sprint stories plus leftover open work from closed sprints"
                                onClick={bulkPullFromJira}
                              >
                                <span className="jira-sync-glyph jira-sync-glyph-pull" aria-hidden>
                                  ↓
                                </span>
                                Pull from Jira
                              </button>
                              {canManageSprintLifecycle ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-teal-900 hover:bg-teal-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0 || !selectedAnyOnCurrentSprint}
                                title={
                                  !selectedAnyOnCurrentSprint
                                    ? "All selected stories are already on Next sprint"
                                    : "Move selected current-sprint stories to Next sprint"
                                }
                                onClick={moveSelectedToNextSprint}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  →
                                </span>
                                Move to next sprint
                              </button>
                              ) : null}
                              {canManageSprintLifecycle ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-sky-900 hover:bg-sky-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0 || !selectedAnyOnNextSprint}
                                title={
                                  !selectedAnyOnNextSprint
                                    ? "All selected stories are already on Current sprint"
                                    : "Move selected next-sprint stories back to Current sprint"
                                }
                                onClick={moveSelectedToCurrentSprint}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  ↩
                                </span>
                                Move to current sprint
                              </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                title={
                                  visibleSelectedCount === 0
                                    ? "Select stories first"
                                    : "Copy selected story names as clickable links"
                                }
                                onClick={copyStoryLinksForSelected}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  ⎘
                                </span>
                                Copy story links
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-orange-900 hover:bg-orange-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                onClick={addTagForSelected}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  #
                                </span>
                                Add Tag
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                onClick={addTodoForSelected}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  ✓
                                </span>
                                Add Todo
                              </button>
                              {canManageSprintLifecycle ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                onClick={setBufferHoursForSelected}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  ◷
                                </span>
                                Set buffer hours…
                              </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-semibold text-orange-900 hover:bg-orange-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                onClick={toggleJiraUpdatesForSelected}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  {selectedJiraUpdatesVisible ? "▣" : "□"}
                                </span>
                                {selectedJiraUpdatesVisible ? "Hide Jira updates" : "Show Jira updates"}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2.5 py-2 text-left text-[12px] font-semibold text-rose-800 hover:bg-rose-50 disabled:opacity-45"
                                disabled={visibleSelectedCount === 0}
                                onClick={removeSelectedTasks}
                              >
                                <span className="w-4 text-center text-[12px] leading-none" aria-hidden>
                                  ×
                                </span>
                                Remove {visibleSelectedCount === 1 ? "Task" : "Tasks"}
                              </button>
                            </div>
                          </div>,
                          document.body,
                        )
                      : null}
                  </div>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">#</span>
                  )}
                </th>
              <th className="w-[14%] text-center">Story</th>
              <th className="w-[7%] text-center">Backend</th>
              <th className="w-[7%] text-center">Frontend</th>
              <th className="w-[15%] text-center">Mobile</th>
              <th className="w-[8%] text-center">Integration</th>
              <th className="w-[7%] text-center">QC</th>
              <th className="w-[8%] text-center leading-tight">
                <div className="flex flex-col items-center gap-0">
                  <span>PM</span>
                  <span className="text-[9px] font-normal normal-case text-slate-500">/ Buffer</span>
                </div>
              </th>
              <th className="w-[7%] text-center">Status</th>
              <th className="w-[11%] text-center leading-tight">
                <div className="flex flex-col items-center justify-center gap-0.5">
                  <span>Release Dates</span>
                </div>
              </th>
              <th className="w-[6%] text-center">Flags</th>
              <th className="w-[9%] text-center">Tools</th>
            </tr>
          </thead>
          <tbody>
            {orderedTasks.length === 0 ? (
              <tr>
                <td colSpan={12} className="p-4 text-center text-sm text-slate-600">
                  <div className="flex flex-col items-center gap-2">
                    <span>
                      {emFilter === "em" && !anyEmStoryMarked
                        ? "No EM stories marked yet. Pull from Jira once to mark stories whose Jira assignee (or EM field) is this squad’s EM — refresh keeps those marks."
                        : "No tasks match the current filters."}
                    </span>
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-[13px]"
                      onClick={() => {
                        setVisibleStatuses(defaultVisibleStatusOptions);
                        setSprintFilter("all");
                        setEmFilter("all");
                        setTypeFilter([]);
                        setKindFilter("all");
                      }}
                    >
                      Reset Filters
                    </button>
                  </div>
                </td>
              </tr>
            ) : null}
            {orderedTasks.map((task, taskIndex) => {
              const computed = taskResultMap.get(task.id);
              const releaseHandoffLabel = releaseDateHandoffLabel(task.status);
              const productionReleaseDate = computed?.releaseDate
                ? computed.productionReleaseDate ?? getProductionReleaseDateFrom(computed.releaseDate, config)
                : null;
              const currentPhase = computed
                ? getCurrentStoryPhase({ ...computed, replanFromStep: task.replanFromStep })
                : getStatusPhase(task.status);
              const phaseClass = (phase: StoryPhase) => (currentPhase === phase ? "phase-current" : "");
              const storyLabel = storyDisplayName(task);
              const todoLineCount = splitTodoLines(task.taskNotes).length;
              const needsMarkProgress = pendingMarkProgressIds.has(task.id);
              const taskNumber = taskIndex + 1;
              return (
                <tr
                  key={task.id}
                  data-task-id={task.id}
                  className={`task-row border-t border-slate-200 ${statusRowClass(task.status)}${needsMarkProgress ? " task-row-pending-mark-progress" : ""}${focusTaskId === task.id ? " task-row-focus" : ""}`}
                >
                  <td className="story-select-col">
                      <div className="story-select-cell-stack">
                        <span
                          className="story-select-task-tag"
                          title={`Row ${taskNumber} of ${orderedTasks.length} in this view`}
                          aria-label={`Row ${taskNumber}`}
                        >
                          <svg className="story-select-task-tag-svg" viewBox="0 0 32 32" aria-hidden>
                            <defs>
                              <linearGradient id={`fold-face-${task.id}`} x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor="#edf2f7" />
                                <stop offset="55%" stopColor="#c5d0de" />
                                <stop offset="100%" stopColor="#9aa8ba" />
                              </linearGradient>
                            </defs>
                            <path
                              className="story-select-task-tag-face"
                              d="M0 0 H32 L0 32 Z"
                              fill={`url(#fold-face-${task.id})`}
                            />
                          </svg>
                          <span className="story-select-task-tag-num">{taskNumber}</span>
                        </span>
                        <label
                          className={`story-select-check-wrap${isEditor ? "" : " pointer-events-none opacity-50"}`}
                          title={isEditor ? `Select ${storyLabel}` : "View only"}
                        >
                          <input
                            type="checkbox"
                            className="story-select-checkbox"
                            checked={isEditor && selectedTaskIdSet.has(task.id)}
                            disabled={!isEditor}
                            onChange={() => {
                              if (!isEditor) return;
                              toggleTaskSelected(task.id);
                            }}
                            aria-label={`Select ${storyLabel}`}
                          />
                        </label>
                        <OrderInput
                          value={task.poPriority}
                          disabled={!isEditor}
                          onChange={(value) => {
                            if (!isEditor) return;
                            updateTask(task.id, { poPriority: value });
                          }}
                        />
                        <ReleaseGroupInput
                          taskId={task.id}
                          value={task.releaseGroup ?? null}
                          storyLabel={storyLabel}
                          colorMap={releaseGroupColorMap}
                          help={RELEASE_GROUP_HELP}
                          disabled={!isEditor}
                          onCommit={(next) => {
                            if (!isEditor) return;
                            updateTask(task.id, { releaseGroup: next });
                          }}
                        />
                      </div>
                    </td>
                  <td className="story-name-cell">
                    <div className="story-cell-group min-w-0">
                      <div className="story-name-row">
                        <div className="story-title-wrap">
                          {(() => {
                            const href = storyHref(task.storyLink);
                            return href ? (
                            <StoryLinkWithPreview
                              href={href}
                              label={storyLabel}
                              storyLink={task.storyLink}
                              squadId={activeSquadId}
                              className="story-title-link"
                            />
                            ) : (
                            <span className="story-title-text" title={storyLabel}>
                              {storyLabel}
                            </span>
                            );
                          })()}
                        </div>
                      </div>
                      {isEditor ||
                      task.issueType ||
                      task.isEmStory ||
                      (task.tags?.length ?? 0) > 0 ||
                      todoLineCount > 0 ? (
                        <div className="story-fields-menu story-fields-menu-below">
                          {task.issueType ? (
                            <span
                              className={`task-flag-chip task-story-type-chip ${issueTypeChipClass(task.issueType)}`}
                              title={`Issue type: ${task.issueType}`}
                            >
                              <span className="task-flag-chip-label">{task.issueType}</span>
                            </span>
                          ) : null}
                          {task.isEmStory ? (
                            <span
                              className="task-flag-chip task-story-type-chip task-flag-chip-type-em"
                              title="Jira assignee (or EM field) matches this squad’s Engineering Manager"
                            >
                              <span className="task-flag-chip-label">EM</span>
                            </span>
                          ) : null}
                          {(task.tags ?? []).map((tag) =>
                            isEditor ? (
                              <span
                                key={tag}
                                className="task-flag-chip task-story-type-chip task-flag-chip-tag group inline-flex items-start gap-1"
                                title={tag}
                              >
                                <span className="task-flag-chip-label">{formatTagLabel(tag)}</span>
                                <button
                                  type="button"
                                  className="shrink-0 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-700 focus-visible:opacity-100 focus-visible:outline-none"
                                  aria-label={`Remove tag ${tag}`}
                                  onClick={() => {
                                    setAssigneePickerOpen(null);
                                    updateTask(task.id, {
                                      tags: (task.tags ?? []).filter((item) => item !== tag),
                                    });
                                  }}
                                >
                                  ×
                                </button>
                              </span>
                            ) : (
                              <span
                                key={tag}
                                className="task-flag-chip task-story-type-chip task-flag-chip-tag"
                                title={tag}
                              >
                                <span className="task-flag-chip-label">{formatTagLabel(tag)}</span>
                              </span>
                            ),
                          )}
                          {todoLineCount > 0 ? (
                            <button
                              type="button"
                              className="task-flag-chip task-story-type-chip task-flag-chip-todo"
                              onClick={() => {
                                setAssigneePickerOpen(null);
                                setTodoModalDraft(task.taskNotes ?? "");
                                setTaskTodoModalId(task.id);
                              }}
                            >
                              <span className="task-flag-chip-label">Todo ({todoLineCount})</span>
                            </button>
                          ) : null}
                          {isEditor ? (
                            <button
                              type="button"
                              className={`story-fields-menu-btn${storyFieldsOpen?.taskId === task.id ? " story-fields-menu-btn-open" : ""}`}
                              aria-expanded={storyFieldsOpen?.taskId === task.id}
                              aria-haspopup="true"
                              aria-label={`Edit name and link for ${storyLabel}`}
                              title="Edit name & link"
                              onClick={(event) => {
                                event.stopPropagation();
                                const trigger = event.currentTarget;
                                setIsBulkStoryMenuOpen(false);
                                setAssigneePickerOpen(null);
                                setStoryFieldsDraft({
                                  storyName: task.storyName ?? "",
                                  storyLink: task.storyLink ?? "",
                                });
                                setStoryFieldsOpen((open) =>
                                  open?.taskId === task.id ? null : { taskId: task.id, trigger },
                                );
                              }}
                            >
                              Edit link
                              <span aria-hidden>{storyFieldsOpen?.taskId === task.id ? "▴" : "▾"}</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="min-w-0">
                    <div className={`phase-be w-full min-w-0 ${phaseClass("BE")}`}>
                      <div className="phase-box-header">
                        <div className="phase-col-label">BE Devs</div>
                        <NumberStepper
                          value={task.beHours}
                          min={0}
                          max={80}
                          disabled={!isEditor}
                          className="shrink-0"
                          aria-label="Backend hours"
                          onChange={(value) => updateTask(task.id, { beHours: clampHours(value ?? 0) })}
                        />
                      </div>
                      <div className="relative">
                        {isEditor ? (
                          <button
                            type="button"
                            className="assignee-picker-trigger"
                            aria-expanded={assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "be"}
                            aria-haspopup="listbox"
                            onClick={(event) => toggleAssigneePicker(task.id, "be", event.currentTarget)}
                          >
                            <span className={`min-w-0 truncate ${task.beDevs.length === 0 ? "text-slate-500" : ""}`}>
                              {task.beDevs.length === 0 ? "Choose…" : `${task.beDevs.length} selected`}
                            </span>
                            <span className="text-slate-400" aria-hidden>
                              ▾
                            </span>
                          </button>
                        ) : (
                          <div className="assignee-picker-summary truncate">
                            {task.beDevs.length === 0 ? "None" : `${task.beDevs.length} selected`}
                          </div>
                        )}
                        {isEditor
                          ? renderTablePickerPortal(
                              task.id,
                              "be",
                              beOptions.map((item) => (
                                <label key={item.name} className="assignee-picker-option">
                                  <input
                                    type="checkbox"
                                    checked={task.beDevs.includes(item.name)}
                                    onChange={() => updateTask(task.id, { beDevs: toggleName(task.beDevs, item.name) })}
                                  />
                                  <button
                                    type="button"
                                    className="assignee-picker-option-name"
                                    title={`${item.name} — planned hours`}
                                    onClick={() => openAssigneeInsight(item.name, resources, setInsightResourceName)}
                                  >
                                    {resourceDisplayName(item)}
                                  </button>
                                </label>
                              )),
                              { multiselectable: true },
                            )
                          : null}
                      </div>
                      <div className="flex flex-wrap gap-0.5">
                        {task.beDevs.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="assignee-selected-tag"
                            title={`${name} — planned hours`}
                            onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                          >
                            {assigneeLabel(name, resources)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0">
                    <div className={`phase-fe w-full min-w-0 ${phaseClass("FE")}`}>
                      <div className="phase-box-header">
                        <div className="phase-col-label">FE Devs</div>
                        <NumberStepper
                          value={task.feHours}
                          min={0}
                          max={80}
                          disabled={!isEditor}
                          className="shrink-0"
                          aria-label="Frontend hours"
                          onChange={(value) => updateTask(task.id, { feHours: clampHours(value ?? 0) })}
                        />
                      </div>
                      <div className="relative">
                        {isEditor ? (
                          <button
                            type="button"
                            className="assignee-picker-trigger"
                            aria-expanded={assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "fe"}
                            aria-haspopup="listbox"
                            onClick={(event) => toggleAssigneePicker(task.id, "fe", event.currentTarget)}
                          >
                            <span className={`min-w-0 truncate ${task.feDevs.length === 0 ? "text-slate-500" : ""}`}>
                              {task.feDevs.length === 0 ? "Choose…" : `${task.feDevs.length} selected`}
                            </span>
                            <span className="text-slate-400" aria-hidden>
                              ▾
                            </span>
                          </button>
                        ) : (
                          <div className="assignee-picker-summary truncate">
                            {task.feDevs.length === 0 ? "None" : `${task.feDevs.length} selected`}
                          </div>
                        )}
                        {isEditor
                          ? renderTablePickerPortal(
                              task.id,
                              "fe",
                              feOptions.map((item) => (
                                <label key={item.name} className="assignee-picker-option">
                                  <input
                                    type="checkbox"
                                    checked={task.feDevs.includes(item.name)}
                                    onChange={() => updateTask(task.id, { feDevs: toggleName(task.feDevs, item.name) })}
                                  />
                                  <button
                                    type="button"
                                    className="assignee-picker-option-name"
                                    title={`${item.name} — planned hours`}
                                    onClick={() => openAssigneeInsight(item.name, resources, setInsightResourceName)}
                                  >
                                    {resourceDisplayName(item)}
                                  </button>
                                </label>
                              )),
                              { multiselectable: true },
                            )
                          : null}
                      </div>
                      <div className="flex flex-wrap gap-0.5">
                        {task.feDevs.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="assignee-selected-tag"
                            title={`${name} — planned hours`}
                            onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                          >
                            {assigneeLabel(name, resources)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0">
                    <div className="mobile-phase-row">
                      <div
                        className={`mobile-phase-platforms${task.needsIos ? " mobile-phase-platforms-split" : ""}`}
                      >
                        <div className={`phase-android w-full min-w-0 ${phaseClass("Android")}`}>
                          <div className="phase-box-header">
                            <div className="phase-col-label">Android</div>
                            <div className="mobile-header-hours-row">
                              <div className="mobile-meta-info">
                                {task.moStartDate ? (
                                  <span
                                    className="mobile-meta-chip"
                                    title={`Mobile start: ${task.moStartDate}`}
                                  >
                                    {task.moStartDate.slice(5)}
                                  </span>
                                ) : null}
                                {task.mobileApp === "star" || task.mobileApp === "hubs" ? (
                                  <span
                                    className="mobile-meta-chip"
                                    title={mobileAppLabel(task.mobileApp) ?? undefined}
                                  >
                                    {task.mobileApp === "star" ? "Star" : "Hubs"}
                                  </span>
                                ) : null}
                              </div>
                              <NumberStepper
                                value={task.androidHours}
                                min={0}
                                max={80}
                                disabled={!isEditor}
                                className="shrink-0"
                                aria-label="Android hours"
                                onChange={(value) =>
                                  updateTask(task.id, { androidHours: clampHours(value ?? 0) })
                                }
                              />
                            </div>
                          </div>
                          <div className="mobile-android-controls">
                            <div className="relative min-w-0 mobile-android-choose">
                              {isEditor ? (
                                <button
                                  type="button"
                                  className="assignee-picker-trigger"
                                  aria-expanded={
                                    assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "android"
                                  }
                                  aria-haspopup="listbox"
                                  onClick={(event) => toggleAssigneePicker(task.id, "android", event.currentTarget)}
                                >
                                  <span
                                    className={`min-w-0 truncate ${task.androidDevs.length === 0 ? "text-slate-500" : ""}`}
                                  >
                                    {task.androidDevs.length === 0 ? "Choose…" : `${task.androidDevs.length} selected`}
                                  </span>
                                  <span className="text-slate-400" aria-hidden>
                                    ▾
                                  </span>
                                </button>
                              ) : (
                                <div className="assignee-picker-summary truncate">
                                  {task.androidDevs.length === 0 ? "None" : `${task.androidDevs.length} selected`}
                                </div>
                              )}
                              {isEditor
                                ? renderTablePickerPortal(
                                    task.id,
                                    "android",
                                    mobileOptions.map((item) => (
                                      <label key={item.name} className="assignee-picker-option">
                                        <input
                                          type="checkbox"
                                          checked={task.androidDevs.includes(item.name)}
                                          onChange={() =>
                                            updateTask(task.id, {
                                              androidDevs: toggleName(task.androidDevs, item.name),
                                            })
                                          }
                                        />
                                        <button
                                          type="button"
                                          className="assignee-picker-option-name"
                                          title={`${item.name} — planned hours`}
                                          onClick={() =>
                                            openAssigneeInsight(item.name, resources, setInsightResourceName)
                                          }
                                        >
                                          {resourceDisplayName(item)}
                                        </button>
                                      </label>
                                    )),
                                    { multiselectable: true },
                                  )
                                : null}
                            </div>
                            <button
                              type="button"
                              className={`mobile-options-toggle${
                                mobileOptionsOpen?.taskId === task.id ? " mobile-options-toggle-on" : ""
                              }`}
                              aria-expanded={mobileOptionsOpen?.taskId === task.id}
                              onClick={(event) => toggleMobileOptions(task.id, event.currentTarget)}
                            >
                              {mobileOptionsOpen?.taskId === task.id ? "Opts ▴" : "Opts ▾"}
                            </button>
                            {mobileOptionsOpen?.taskId === task.id && typeof document !== "undefined"
                              ? createPortal(
                                  <div
                                    ref={mobileOptionsPanelRef}
                                    className="mobile-options-panel mobile-options-dropdown-portal"
                                    role="region"
                                    aria-label="Mobile options"
                                    style={{
                                      position: "fixed",
                                      top: mobileOptionsPos.top,
                                      left: mobileOptionsPos.left,
                                      width: mobileOptionsPos.width,
                                      zIndex: 1000,
                                    }}
                                  >
                                    <div className="mobile-options-row">
                                      <span className="mobile-options-label">Start date</span>
                                      <button
                                        type="button"
                                        className="mobile-options-action"
                                        disabled={!isEditor}
                                        title={
                                          task.moStartDate
                                            ? `Mobile start: ${task.moStartDate}`
                                            : "Optional Mobile start date"
                                        }
                                        aria-label="Mobile start date"
                                        onClick={() => setMoStartDateModalId(task.id)}
                                      >
                                        {task.moStartDate ? task.moStartDate : "Pick date…"}
                                      </button>
                                    </div>
                                    <div className="mobile-options-row">
                                      <span className="mobile-options-label">App</span>
                                      {isEditor ? (
                                        <select
                                          className="mobile-options-action mobile-options-select"
                                          value={task.mobileApp ?? "none"}
                                          aria-label="Mobile app flag"
                                          onChange={(event) =>
                                            updateTask(task.id, {
                                              mobileApp: event.target.value as MobileAppFlag,
                                            })
                                          }
                                        >
                                          <option value="none">None</option>
                                          <option value="star">Star app</option>
                                          <option value="hubs">Hubs app</option>
                                        </select>
                                      ) : (
                                        <span className="mobile-options-readonly">
                                          {mobileAppLabel(task.mobileApp) ?? "None"}
                                        </span>
                                      )}
                                    </div>
                                    <label className="mobile-options-row mobile-options-row-toggle">
                                      <span className="mobile-options-label">Needs iOS</span>
                                      <input
                                        type="checkbox"
                                        className="mobile-options-checkbox"
                                        disabled={!isEditor}
                                        checked={task.needsIos}
                                        onChange={(event) => {
                                          if (event.target.checked) {
                                            updateTask(task.id, { needsIos: true });
                                            return;
                                          }
                                          updateTask(task.id, {
                                            needsIos: false,
                                            iosHours: 0,
                                            iosDevs: [],
                                          });
                                        }}
                                      />
                                    </label>
                                  </div>,
                                  document.body,
                                )
                              : null}
                          </div>
                          <div className="flex flex-wrap gap-0.5">
                            {task.androidDevs.map((name) => (
                              <button
                                key={name}
                                type="button"
                                className="assignee-selected-tag"
                                title={`${name} — planned hours`}
                                onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                              >
                                {assigneeLabel(name, resources)}
                              </button>
                            ))}
                          </div>
                        </div>
                        {task.needsIos ? (
                          <div className={`phase-ios w-full min-w-0 ${phaseClass("IOS")}`}>
                            <div className="phase-box-header">
                              <div className="phase-col-label">IOS</div>
                              <NumberStepper
                                value={task.iosHours}
                                min={0}
                                max={80}
                                disabled={!isEditor}
                                className="shrink-0"
                                aria-label="IOS hours"
                                onChange={(value) => updateTask(task.id, { iosHours: clampHours(value ?? 0) })}
                              />
                            </div>
                            <div className="relative min-w-0">
                              {isEditor ? (
                                <button
                                  type="button"
                                  className="assignee-picker-trigger"
                                  aria-expanded={
                                    assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "ios"
                                  }
                                  aria-haspopup="listbox"
                                  onClick={(event) => toggleAssigneePicker(task.id, "ios", event.currentTarget)}
                                >
                                  <span
                                    className={`min-w-0 truncate ${task.iosDevs.length === 0 ? "text-slate-500" : ""}`}
                                  >
                                    {task.iosDevs.length === 0 ? "Choose…" : `${task.iosDevs.length} selected`}
                                  </span>
                                  <span className="text-slate-400" aria-hidden>
                                    ▾
                                  </span>
                                </button>
                              ) : (
                                <div className="assignee-picker-summary truncate">
                                  {task.iosDevs.length === 0 ? "None" : `${task.iosDevs.length} selected`}
                                </div>
                              )}
                              {isEditor
                                ? renderTablePickerPortal(
                                    task.id,
                                    "ios",
                                    mobileOptions.map((item) => (
                                      <label key={item.name} className="assignee-picker-option">
                                        <input
                                          type="checkbox"
                                          checked={task.iosDevs.includes(item.name)}
                                          onChange={() =>
                                            updateTask(task.id, {
                                              iosDevs: toggleName(task.iosDevs, item.name),
                                            })
                                          }
                                        />
                                        <button
                                          type="button"
                                          className="assignee-picker-option-name"
                                          title={`${item.name} — planned hours`}
                                          onClick={() =>
                                            openAssigneeInsight(item.name, resources, setInsightResourceName)
                                          }
                                        >
                                          {resourceDisplayName(item)}
                                        </button>
                                      </label>
                                    )),
                                    { multiselectable: true },
                                  )
                                : null}
                            </div>
                            <div className="flex flex-wrap gap-0.5">
                              {task.iosDevs.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  className="assignee-selected-tag"
                                  title={`${name} — planned hours`}
                                  onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                                >
                                  {assigneeLabel(name, resources)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0">
                    <div className={`phase-int w-full min-w-0 ${phaseClass("Integration")}`}>
                      <div className="phase-box-header">
                        <div className="phase-col-label">Integration</div>
                        <NumberStepper
                          value={task.integrationHours}
                          min={0}
                          max={80}
                          disabled={!isEditor}
                          className="shrink-0"
                          aria-label="Integration hours"
                          onChange={(value) =>
                            updateTask(task.id, { integrationHours: clampHours(value ?? 0) })
                          }
                        />
                      </div>
                      {(() => {
                        const intSelectedCount = [
                          task.integrationFlags?.needsDevOps,
                          task.integrationFlags?.needsCdc,
                          task.integrationFlags?.needsDbSync,
                          task.integrationFlags?.needsOtherSquad,
                          task.integrationFlags?.needsThirdParty,
                        ].filter(Boolean).length;
                        return (
                          <div className="relative">
                            {isEditor ? (
                              <button
                                type="button"
                                className="assignee-picker-trigger"
                                aria-expanded={
                                  assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "int"
                                }
                                aria-haspopup="listbox"
                                onClick={(event) => toggleAssigneePicker(task.id, "int", event.currentTarget)}
                              >
                                <span className={`min-w-0 truncate ${intSelectedCount === 0 ? "text-slate-500" : ""}`}>
                                  {intSelectedCount === 0
                                    ? "Choose…"
                                    : `${intSelectedCount} selected`}
                                </span>
                                <span className="text-slate-400" aria-hidden>
                                  ▾
                                </span>
                              </button>
                            ) : (
                              <div className="assignee-picker-summary truncate">
                                {intSelectedCount === 0 ? "None" : `${intSelectedCount} flag${intSelectedCount === 1 ? "" : "s"} on`}
                              </div>
                            )}
                            {isEditor
                              ? renderTablePickerPortal(
                                  task.id,
                                  "int",
                                  <>
                                    <label className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={task.integrationFlags?.needsDevOps ?? false}
                                        onChange={(event) =>
                                          updateIntegrationFlags(task, { needsDevOps: event.target.checked })
                                        }
                                      />
                                      <span>DevOps Needed</span>
                                    </label>
                                    <label className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={task.integrationFlags?.needsCdc ?? false}
                                        onChange={(event) =>
                                          updateIntegrationFlags(task, { needsCdc: event.target.checked })
                                        }
                                      />
                                      <span>CDC Needed</span>
                                    </label>
                                    <label className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={task.integrationFlags?.needsDbSync ?? false}
                                        onChange={(event) =>
                                          updateIntegrationFlags(task, { needsDbSync: event.target.checked })
                                        }
                                      />
                                      <span>DB Sync Needed</span>
                                    </label>
                                    <label className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={task.integrationFlags?.needsOtherSquad ?? false}
                                        onChange={(event) =>
                                          updateIntegrationFlags(task, {
                                            needsOtherSquad: event.target.checked,
                                          })
                                        }
                                      />
                                      <span>Other Squad Needed</span>
                                    </label>
                                    <label className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={task.integrationFlags?.needsThirdParty ?? false}
                                        onChange={(event) =>
                                          updateIntegrationFlags(task, { needsThirdParty: event.target.checked })
                                        }
                                      />
                                      <span>Third Party Needed</span>
                                    </label>
                                  </>,
                                  { multiselectable: true },
                                )
                              : null}
                          </div>
                        );
                      })()}
                      <div className="flex flex-wrap gap-0.5">
                        {task.integrationFlags?.needsDevOps ? (
                          <span className="tag bg-white/70 text-current" title="DevOps needed">
                            DevOps
                          </span>
                        ) : null}
                        {task.integrationFlags?.needsCdc ? (
                          <span className="tag bg-white/70 text-current" title="CDC needed">
                            CDC
                          </span>
                        ) : null}
                        {task.integrationFlags?.needsDbSync ? (
                          <span className="tag bg-white/70 text-current" title="DB sync needed">
                            DB sync
                          </span>
                        ) : null}
                        {task.integrationFlags?.needsOtherSquad ? (
                          <span className="tag bg-white/70 text-current" title="Other squad needed">
                            Other squad
                          </span>
                        ) : null}
                        {task.integrationFlags?.needsThirdParty ? (
                          <span className="tag bg-white/70 text-current" title="Third party needed">
                            3rd party
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0">
                    <div className={`phase-qc w-full min-w-0 ${phaseClass("QC")}`}>
                      <div className="phase-box-header">
                        <div className="phase-col-label">QC Eng</div>
                        <NumberStepper
                          value={task.qcHours}
                          min={0}
                          max={80}
                          disabled={!isEditor}
                          className="shrink-0"
                          aria-label="QC hours"
                          onChange={(value) => updateTask(task.id, { qcHours: clampHours(value ?? 0) })}
                        />
                      </div>
                      <div className="relative">
                        {isEditor ? (
                          <button
                            type="button"
                            className="assignee-picker-trigger"
                            aria-expanded={assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "qc"}
                            aria-haspopup="listbox"
                            onClick={(event) => toggleAssigneePicker(task.id, "qc", event.currentTarget)}
                          >
                            <span className={`min-w-0 truncate ${task.qcs.length === 0 ? "text-slate-500" : ""}`}>
                              {task.qcs.length === 0 ? "Choose…" : `${task.qcs.length} selected`}
                            </span>
                            <span className="text-slate-400" aria-hidden>
                              ▾
                            </span>
                          </button>
                        ) : (
                          <div className="assignee-picker-summary truncate">
                            {task.qcs.length === 0 ? "None" : `${task.qcs.length} selected`}
                          </div>
                        )}
                        {isEditor
                          ? renderTablePickerPortal(
                              task.id,
                              "qc",
                              qcOptions.map((item) => (
                                <label key={item.name} className="assignee-picker-option">
                                  <input
                                    type="checkbox"
                                    checked={task.qcs.includes(item.name)}
                                    onChange={() => updateTask(task.id, { qcs: toggleName(task.qcs, item.name) })}
                                  />
                                  <button
                                    type="button"
                                    className="assignee-picker-option-name"
                                    title={`${item.name} — planned hours`}
                                    onClick={() => openAssigneeInsight(item.name, resources, setInsightResourceName)}
                                  >
                                    {resourceDisplayName(item)}
                                  </button>
                                </label>
                              )),
                              { multiselectable: true },
                            )
                          : null}
                      </div>
                      <div className="flex flex-wrap gap-0.5">
                        {task.qcs.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="assignee-selected-tag"
                            title={`${name} — planned hours`}
                            onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                          >
                            {assigneeLabel(name, resources)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0 align-top">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="phase-pm w-full min-w-0">
                        <div className="phase-box-header">
                          <div className="phase-col-label">PM</div>
                        </div>
                        <div className="relative">
                          {isEditor ? (
                            <button
                              type="button"
                              className="assignee-picker-trigger"
                              aria-expanded={
                                assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "pm"
                              }
                              aria-haspopup="listbox"
                              onClick={(event) => toggleAssigneePicker(task.id, "pm", event.currentTarget)}
                            >
                              <span
                                className={`min-w-0 truncate ${
                                  (task.productManagers?.length ?? 0) === 0 ? "text-slate-500" : ""
                                }`}
                              >
                                {(task.productManagers?.length ?? 0) === 0
                                  ? "Choose…"
                                  : `${task.productManagers?.length ?? 0} selected`}
                              </span>
                              <span className="text-slate-400" aria-hidden>
                                ▾
                              </span>
                            </button>
                          ) : (
                            <div className="assignee-picker-summary truncate">
                              {(task.productManagers?.length ?? 0) === 0
                                ? "None"
                                : `${task.productManagers?.length ?? 0} selected`}
                            </div>
                          )}
                          {isEditor
                            ? renderTablePickerPortal(
                                task.id,
                                "pm",
                                pmOptions.length === 0 ? (
                                  <p className="px-2 py-1.5 text-[11px] text-slate-500">
                                    No PMs on Resources yet. Add them under Product Manager team.
                                  </p>
                                ) : (
                                  pmOptions.map((item) => (
                                    <label key={item.name} className="assignee-picker-option">
                                      <input
                                        type="checkbox"
                                        checked={(task.productManagers ?? []).includes(item.name)}
                                        onChange={() =>
                                          updateTask(task.id, {
                                            productManagers: toggleName(task.productManagers ?? [], item.name),
                                          })
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="assignee-picker-option-name"
                                        title={item.name}
                                        onClick={() =>
                                          openAssigneeInsight(item.name, resources, setInsightResourceName)
                                        }
                                      >
                                        {resourceDisplayName(item)}
                                      </button>
                                    </label>
                                  ))
                                ),
                                { multiselectable: true },
                              )
                            : null}
                        </div>
                        <div className="flex flex-wrap gap-0.5">
                          {(task.productManagers ?? []).map((name) => (
                            <button
                              key={name}
                              type="button"
                              className="assignee-selected-tag"
                              title={name}
                              onClick={() => openAssigneeInsight(name, resources, setInsightResourceName)}
                            >
                              {assigneeLabel(name, resources)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                          Buffer
                        </span>
                        <NumberStepper
                          value={task.bufferHours ?? 0}
                          min={0}
                          max={80}
                          disabled={!canManageSprintLifecycle}
                          className="shrink-0"
                          title={
                            canManageSprintLifecycle
                              ? "Buffer hours after QC (before release)"
                              : "Only EM / Super Admin can set buffer hours"
                          }
                          aria-label="Buffer hours"
                          onChange={(value) => updateTask(task.id, { bufferHours: clampHours(value ?? 0) })}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="align-top">
                    <div className="flex justify-center">
                      <div className="relative w-full min-w-0">
                        {isEditor ? (
                          <>
                            <button
                              type="button"
                              className={`task-status-picker-trigger ${statusChipClass(task.status)}`}
                              title={task.status}
                              aria-expanded={
                                assigneePickerOpen?.taskId === task.id && assigneePickerOpen?.kind === "status"
                              }
                              aria-haspopup="listbox"
                              onClick={(event) => toggleAssigneePicker(task.id, "status", event.currentTarget)}
                            >
                              <span className="task-status-picker-trigger-label">{task.status}</span>
                              <span className="mt-0.5 shrink-0 text-[9px] text-slate-500" aria-hidden>
                                ▾
                              </span>
                            </button>
                            {renderTablePickerPortal(
                              task.id,
                              "status",
                              <div className="flex flex-col gap-px">
                                {taskStatuses.map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    role="option"
                                    title={status}
                                    aria-selected={task.status === status}
                                    className={`task-status-picker-option ${statusChipClass(status)} ${
                                      task.status === status
                                        ? "ring-1 ring-blue-500/90 ring-offset-0"
                                        : "hover:brightness-[0.98]"
                                    }`}
                                    onClick={() => {
                                      updateTask(task.id, { status });
                                      setAssigneePickerOpen(null);
                                    }}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>,
                              { ariaLabel: "Story status", statusPanel: true },
                            )}
                          </>
                        ) : (
                          <div
                            className={`task-status-picker-summary ${statusChipClass(task.status)} rounded-md`}
                            title={task.status}
                          >
                            {task.status}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="align-top text-center text-[13px] font-bold text-slate-900">
                    <div className="release-date-stack">
                      <div className="release-date-card">
                        <div className="release-date-label">UAT</div>
                        {releaseHandoffLabel ? (
                          <span className="release-date-empty" title={releaseHandoffLabel}>
                            {releaseHandoffLabel}
                          </span>
                        ) : computed?.releaseDate ? (
                          <div className="release-date-value">
                            <span className="release-date-line">
                              {fmtDateOnly(computed.releaseDate)} <span aria-hidden>•</span> {fmtTimeOnly(computed.releaseDate)}
                            </span>
                          </div>
                        ) : canCalculateRelease(task) ? (
                          <span className="release-date-empty">
                            {isUatTrackingEnabled ? "Pending" : "—"}
                          </span>
                        ) : (
                          <span className="release-date-empty">Add hours</span>
                        )}
                      </div>
                      <div className="release-date-card release-date-card-production">
                        <div className="release-date-label release-date-label-production">Production</div>
                        {releaseHandoffLabel ? (
                          <span
                            className="release-date-empty release-date-line-production"
                            title={releaseHandoffLabel}
                          >
                            {releaseHandoffLabel}
                          </span>
                        ) : productionReleaseDate ? (
                          <div className="release-date-value">
                            <span className="release-date-line release-date-line-production">
                              {fmtDateOnly(productionReleaseDate)} <span aria-hidden>•</span> {fmtTimeOnly(productionReleaseDate)}
                            </span>
                          </div>
                        ) : canCalculateRelease(task) ? (
                          <span className="release-date-empty release-date-line-production">
                            {isUatTrackingEnabled ? "Pending" : "—"}
                          </span>
                        ) : (
                          <span className="release-date-empty release-date-line-production">Add hours</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="align-top">
                    <div className="flex w-full min-w-0 flex-wrap content-start gap-0.5">
                      {task.carryToNextSprint ? (
                        <span
                          className="task-flag-chip task-flag-chip-next-sprint"
                          title="This story is carried to the next sprint"
                        >
                          <span className="task-flag-chip-label">Next sprint</span>
                        </span>
                      ) : null}
                      {needsMarkProgress ? (
                        <span
                          className="task-flag-chip task-flag-chip-pending-sync"
                          title="Hours or schedule edited since last Mark Progress Now — click Mark Progress Now to refresh Cur dates."
                        >
                          <span className="task-flag-chip-label">Need remark</span>
                        </span>
                      ) : null}
                      {computed?.isOverflow ? (
                        <span className="task-flag-chip task-flag-chip-overflow">
                          <span className="task-flag-chip-label">Overflow</span>
                        </span>
                      ) : null}
                      {computed
                        ? (() => {
                            const thursdayLabel = thursdayReleaseChipLabel(computed.thursdayReleaseScope);
                            return thursdayLabel ? (
                              <span className="task-flag-chip task-flag-chip-thursday">
                                <span className="task-flag-chip-label">{thursdayLabel}</span>
                              </span>
                            ) : null;
                          })()
                        : null}
                    </div>
                  </td>
                  <td className="tools-col align-top">
                    <div className="mx-auto flex w-full min-w-0 flex-col items-stretch justify-center gap-0.5 py-0">
                      <div
                        className="tools-hours-summary"
                        title="Dev = BE + FE + Mobile + Integration · Total adds QC + Buffer"
                      >
                        <div className="tools-hours-item">
                          <span className="tools-hours-label">Dev</span>
                          <span className="tools-hours-value">{developmentHours(task)}h</span>
                        </div>
                        <div className="tools-hours-item">
                          <span className="tools-hours-label">Total</span>
                          <span className="tools-hours-value">{totalEffortHours(task)}h</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="row-action-btn row-action-primary"
                        onClick={() => setSelectedTimelineTaskId(task.id)}
                      >
                        📅 Timeline
                      </button>
                      {task.jira || isJiraStoryLink(task.storyLink) ? (
                        <div className="tools-jira-block">
                          <button
                            type="button"
                            className={`row-action-btn w-full ${
                              expandedJiraTaskIdSet.has(task.id) ? "row-action-emerald-on" : "row-action-emerald"
                            }`}
                            aria-expanded={expandedJiraTaskIdSet.has(task.id)}
                            onClick={() => toggleJiraExpanded(task.id)}
                          >
                            {expandedJiraTaskIdSet.has(task.id) ? "Hide Jira ▴" : "Jira updates ▾"}
                          </button>
                          {expandedJiraTaskIdSet.has(task.id) ? (
                            <div className="tools-jira-dropdown" role="region" aria-label="Jira updates">
                              {task.jira?.parentIssueKey ? (
                                <div className="font-semibold text-slate-800">
                                  Parent{" "}
                                  {(() => {
                                    const href = buildJiraIssueBrowseUrl(
                                      task.storyLink,
                                      task.jira.parentIssueKey,
                                    );
                                    return href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-700 underline"
                                  >
                                    {task.jira.parentIssueKey}
                                  </a>
                                    ) : (
                                      <span>{task.jira.parentIssueKey}</span>
                                    );
                                  })()}
                                </div>
                              ) : null}
                              <div>
                                Last push:{" "}
                                {task.jira?.lastPushedAt
                                  ? format(new Date(task.jira.lastPushedAt), "dd MMM HH:mm")
                                  : "—"}
                              </div>
                              <div>
                                Last pull:{" "}
                                {task.jira?.lastPulledAt
                                  ? format(new Date(task.jira.lastPulledAt), "dd MMM HH:mm")
                                  : "—"}
                              </div>
                              {(task.jira?.subtasks ?? []).length > 0 ? (
                                <div className="mt-0.5 space-y-0.5 border-t border-emerald-100/80 pt-0.5">
                                  {task.jira!.subtasks.map((subtask) => {
                                    const href = buildJiraIssueBrowseUrl(task.storyLink, subtask.key);
                                    const label = (
                                      <>
                                      {subtask.key} · {subtask.role.toUpperCase()} {subtask.assigneeName || "—"} ·{" "}
                                      {subtask.hours}h
                                      </>
                                    );
                                    return href ? (
                                    <a
                                      key={subtask.key}
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block truncate text-blue-700 underline"
                                      title={`${subtask.role.toUpperCase()} ${subtask.assigneeName} · ${subtask.hours}h`}
                                    >
                                      {label}
                                    </a>
                                    ) : (
                                      <div key={subtask.key} className="block truncate text-slate-700">
                                        {label}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-slate-500">No synced subtasks yet</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedTimelineTask && selectedTimelineComputed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setSelectedTimelineTaskId(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-6xl overflow-auto rounded-2xl border border-slate-300 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Story Timeline:{" "}
                  {(() => {
                    const href = storyHref(selectedTimelineTask.storyLink);
                    const label =
                      selectedTimelineTask.storyName ||
                      selectedTimelineTask.storyLink ||
                      selectedTimelineTask.id;
                    return href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline"
                    >
                      {label}
                    </a>
                    ) : (
                      label
                    );
                  })()}
                </h3>
                <p className="text-sm text-slate-600">
                  Status: {selectedTimelineTask.status}
                  {" · "}
                  UAT release:{" "}
                  {selectedTimelineHandoffLabel ??
                    (selectedTimelineComputed.releaseDate
                      ? fmt(selectedTimelineComputed.releaseDate)
                      : "Pending schedule")}
                  {selectedTimelineHandoffLabel ? (
                    <>
                      {" · "}
                      Production: {selectedTimelineHandoffLabel}
                    </>
                  ) : selectedTimelineComputed.productionReleaseDate ? (
                    <>
                      {" · "}
                      Production: {fmt(selectedTimelineComputed.productionReleaseDate)}
                    </>
                  ) : null}
                </p>
                {selectedTimelineComputed.bufferEnd &&
                selectedTimelineComputed.releaseDate &&
                Math.abs(
                  selectedTimelineComputed.bufferEnd.getTime() -
                    selectedTimelineComputed.releaseDate.getTime(),
                ) > 60_000 ? (
                  <p className="mt-1 text-[12px] text-slate-500">
                    Schedule work ends {fmt(selectedTimelineComputed.bufferEnd)} (last phase). UAT release can
                    differ when release-group alignment or Mark Progress freeze applies — use{" "}
                    <span className="font-semibold">Mark Progress Now</span> to refresh both together.
                  </p>
                ) : null}
                {pendingMarkProgressIds.has(selectedTimelineTask.id) ? (
                  <p className="mt-1 text-[12px] font-medium text-amber-800">
                    This story needs Mark Progress Now to refresh Cur dates after hours/schedule edits.
                  </p>
                ) : null}
                {isEditor ? (
                  <label className="mt-2 flex items-center gap-2 text-[13px] font-medium text-slate-700">
                    <span>Replan from step:</span>
                    <select
                      className="field-input w-auto min-w-[13.5rem] px-2 py-1 text-[13px]"
                      value={replanStepSelectValue(selectedTimelineTask.replanFromStep)}
                      onChange={(event) =>
                        updateTask(selectedTimelineTask.id, {
                          replanFromStep: event.target.value as TaskReplanStep,
                        })
                      }
                    >
                      {replanStepOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <p className="mt-1 text-[12px] text-slate-500">
                  {selectedTimelineTask.replanFromStep === "Buffer"
                    ? "Legacy buffer-only replan — only buffer hours remain scheduled."
                    : replanStepOptions.find(
                        (option) => option.value === replanStepSelectValue(selectedTimelineTask.replanFromStep),
                      )?.hint}
                </p>
              </div>
              <button className="btn-secondary px-2 py-1 text-[13px]" onClick={() => setSelectedTimelineTaskId(null)}>
                Close
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
              {(selectedTimelineTask.integrationFlags?.needsDevOps ?? false) && (
                <span className="tag bg-violet-100 text-violet-800">DevOps Needed</span>
              )}
              {(selectedTimelineTask.integrationFlags?.needsCdc ?? false) && (
                <span className="tag bg-violet-100 text-violet-800">CDC Needed</span>
              )}
              {(selectedTimelineTask.integrationFlags?.needsDbSync ?? false) && (
                <span className="tag bg-violet-100 text-violet-800">DB Sync Needed</span>
              )}
              {(selectedTimelineTask.integrationFlags?.needsOtherSquad ?? false) && (
                <span className="tag bg-violet-100 text-violet-800">Other Squad Needed</span>
              )}
              {(selectedTimelineTask.integrationFlags?.needsThirdParty ?? false) && (
                <span className="tag bg-violet-100 text-violet-800">Third Party Needed</span>
              )}
            </div>
            <section className="mt-1">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Schedule flow</h4>
              <StoryPhaseFlow
                task={selectedTimelineComputed}
                currentPhase={modalCurrentPhase}
                phasePlan={storyPhasePlanFromTask(selectedTimelineTask)}
              />
            </section>
          </div>
        </div>
      )}
      {moStartDateModalTask ? (
        <MobileStartDateModal
          key={moStartDateModalTask.id}
          task={moStartDateModalTask}
          disabled={!isEditor}
          onClose={() => setMoStartDateModalId(null)}
          onSave={(moStartDate) => updateTask(moStartDateModalTask.id, { moStartDate })}
        />
      ) : null}
      {tagModalTask ? (
        <div
          className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(12vh,6rem)]"
          onClick={() => {
            setTaskTagModalId(null);
            setTagInputDraft("");
          }}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-tags-title"
          >
            <h3 id="task-tags-title" className="text-lg font-semibold text-slate-900">
              Tags
            </h3>
            <p className="mt-1 truncate text-sm text-slate-600" title={(tagModalTask.storyName ?? "").trim() || tagModalTask.storyLink || tagModalTask.id}>
              {(tagModalTask.storyName ?? "").trim() || tagModalTask.storyLink || tagModalTask.id}
            </p>
            <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {(tagModalTask.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-yellow-200/90 bg-yellow-50 px-2 py-1 text-[13px] font-medium text-yellow-900 shadow-sm"
                >
                  <span className="truncate">{tag}</span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-600 hover:text-red-700"
                    aria-label={`Remove ${tag}`}
                    onClick={() =>
                      updateTask(tagModalTask.id, {
                        tags: (tagModalTask.tags ?? []).filter((item) => item !== tag),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input
                className="field-input min-w-0 flex-1 text-sm"
                placeholder="New tag"
                maxLength={48}
                value={tagInputDraft}
                onChange={(event) => setTagInputDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const next = tagInputDraft.trim();
                    if (!next) return;
                    const cur = tagModalTask.tags ?? [];
                    if (cur.includes(next) || cur.length >= 20) return;
                    updateTask(tagModalTask.id, { tags: [...cur, next] });
                    setTagInputDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="btn-primary shrink-0 px-3 py-2 text-sm"
                onClick={() => {
                  const next = tagInputDraft.trim();
                  if (!next) return;
                  const cur = tagModalTask.tags ?? [];
                  if (cur.includes(next) || cur.length >= 20) return;
                  updateTask(tagModalTask.id, { tags: [...cur, next] });
                  setTagInputDraft("");
                }}
              >
                Add
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-sm"
                onClick={() => {
                  setTaskTagModalId(null);
                  setTagInputDraft("");
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {todoModalTask ? (
        <div
          className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[min(10vh,5rem)]"
          onClick={() => setTaskTodoModalId(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-todo-title"
          >
            <h3 id="task-todo-title" className="text-lg font-semibold text-slate-900">
              Todo
            </h3>
            <p className="mt-1 truncate text-sm text-slate-600" title={(todoModalTask.storyName ?? "").trim() || todoModalTask.storyLink || todoModalTask.id}>
              {(todoModalTask.storyName ?? "").trim() || todoModalTask.storyLink || todoModalTask.id}
            </p>
            {splitTodoLines(todoModalDraft).length > 0 ? (
              <ul className="mt-4 max-h-48 list-inside list-disc space-y-1 overflow-y-auto text-sm text-slate-800">
                {splitTodoLines(todoModalDraft).map((line, index) => (
                  <li key={`${index}-${line.slice(0, 24)}`} className="pl-0.5">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No todo items yet. {isEditor ? "Add lines below (one per item)." : ""}</p>
            )}
            {isEditor ? (
              <label className="mt-4 block space-y-1">
                <span className="text-[13px] font-medium text-slate-600">Edit (one line per point)</span>
                <textarea
                  className="field-input min-h-[9rem] w-full resize-y font-mono text-sm"
                  placeholder={"e.g.\nAPI contract\nQA sign-off"}
                  value={todoModalDraft}
                  onChange={(event) => setTodoModalDraft(event.target.value)}
                />
              </label>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setTaskTodoModalId(null)}>
                {isEditor ? "Cancel" : "Close"}
              </button>
              {isEditor ? (
                <button
                  type="button"
                  className="btn-primary px-3 py-1.5 text-sm"
                  onClick={() => {
                    updateTask(todoModalTask.id, { taskNotes: todoModalDraft });
                    setTaskTodoModalId(null);
                  }}
                >
                  Save
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {taskPendingDelete ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setTaskPendingDelete(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-task-title"
          >
            <h3 id="delete-task-title" className="text-lg font-semibold text-slate-900">
              Remove task?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {(() => {
                const t = tasks.find((item) => item.id === taskPendingDelete);
                const label = t
                  ? (t.storyName ?? "").trim() || t.storyLink.trim() || t.id
                  : "This task";
                return `This will remove the task “${label}” from the planner. This cannot be undone.`;
              })()}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setTaskPendingDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger px-3 py-1.5 text-sm"
                onClick={() => {
                  const id = taskPendingDelete;
                  removeTask(id);
                  setTaskPendingDelete(null);
                  if (id && taskTagModalId === id) {
                    setTaskTagModalId(null);
                    setTagInputDraft("");
                  }
                  if (id && taskTodoModalId === id) {
                    setTaskTodoModalId(null);
                  }
                  if (id && moStartDateModalId === id) {
                    setMoStartDateModalId(null);
                  }
                }}
              >
                Remove Task
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isBulkAddOpen ? (
        <BulkAddTasksModal
          resources={resources}
          onCancel={() => setIsBulkAddOpen(false)}
          onConfirm={(rows) => {
            const newIds = addTasks(rows);
            setIsBulkAddOpen(false);
            if (newIds.length > 0) {
              setFocusTaskId(newIds[newIds.length - 1] ?? null);
            }
          }}
        />
      ) : null}
      {storyFieldsOpen && storyFieldsTask && typeof document !== "undefined"
        ? createPortal(
            <form
              ref={storyFieldsMenuRef}
              className="story-fields-menu-panel story-fields-menu-panel-portal"
              aria-label="Story name and link"
              style={{
                position: "fixed",
                top: storyFieldsMenuPos.top,
                left: storyFieldsMenuPos.left,
                width: storyFieldsMenuPos.width,
                zIndex: 1000,
              }}
              onSubmit={(event) => {
                event.preventDefault();
                commitOpenStoryFields(true);
              }}
            >
              <label className="story-fields-field">
                <span>Name</span>
                <input
                  disabled={!isEditor}
                  className="field-input w-full rounded-xl border-slate-500 px-2 py-1 text-[12px] font-semibold"
                  title={storyFieldsDraft.storyName || "Story name"}
                  placeholder="Story Name"
                  value={storyFieldsDraft.storyName}
                  onChange={(event) =>
                    setStoryFieldsDraft((current) => ({ ...current, storyName: event.target.value }))
                  }
                  autoFocus
                />
              </label>
              <label className="story-fields-field">
                <span>Link</span>
                <input
                  ref={(input) => {
                    linkInputsRef.current[storyFieldsTask.id] = input;
                  }}
                  disabled={!isEditor}
                  className="field-input w-full rounded-xl border-dashed border-blue-400 px-2 py-1 text-[12px]"
                  title={storyFieldsDraft.storyLink || "Story link"}
                  placeholder="https://…"
                  value={storyFieldsDraft.storyLink}
                  onChange={(event) =>
                    setStoryFieldsDraft((current) => ({ ...current, storyLink: event.target.value }))
                  }
                />
              </label>
              {isEditor ? (
                <div className="flex justify-end gap-1.5 pt-0.5">
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    onClick={() => setStoryFieldsOpen(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary px-2.5 py-1 text-[11px]">
                    Save
                  </button>
                </div>
              ) : null}
            </form>,
            document.body,
          )
        : null}
      <ResourceInsightModal resourceName={insightResourceName} onClose={() => setInsightResourceName(null)} />
    </div>
  );
}
