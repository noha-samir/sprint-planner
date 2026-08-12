import { z } from "zod";

const maxTasks = 500;
const maxResources = 200;

const taskSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    storyName: z.string().max(500).optional(),
    storyLink: z.string().max(2000).optional(),
    status: z.string().max(80).optional(),
  })
  .passthrough();

const resourceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.string().max(40).optional(),
  })
  .passthrough();

export const plannerStateWriteSchema = z.object({
  tasks: z.array(taskSchema).max(maxTasks).optional(),
  resources: z.array(resourceSchema).max(maxResources).optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  plannerMeta: z.record(z.string(), z.unknown()).nullable().optional(),
  timelineStartDate: z.string().max(40).nullable().optional(),
  baseUpdatedAt: z.string().max(64).nullable().optional(),
  updatedAt: z.string().max(64).optional(),
});

export type PlannerStateWriteInput = z.infer<typeof plannerStateWriteSchema>;

export const parsePlannerStateWriteBody = (body: unknown): PlannerStateWriteInput =>
  plannerStateWriteSchema.parse(body);

export const historyWriteSchema = z.object({
  tasks: z.array(taskSchema).max(maxTasks).optional(),
  resources: z.array(resourceSchema).max(maxResources).optional(),
  config: z.record(z.string(), z.unknown()),
});

export const parseHistoryWriteBody = (body: unknown) => historyWriteSchema.parse(body);

const parentFieldsSchema = z
  .object({
    developmentEstimateHours: z.string().max(80).optional(),
    testingEstimateHours: z.string().max(80).optional(),
    qcEngineer: z.string().max(80).optional(),
    productManager: z.string().max(80).optional(),
    branchName: z.string().max(80).optional(),
  })
  .partial();

export const squadJiraConfigWriteSchema = z
  .object({
    siteUrl: z.string().max(300).optional(),
    projectKey: z.string().max(32).optional(),
    issueTypeSubTask: z.string().max(80).optional(),
    parentStoryFields: parentFieldsSchema.optional(),
    qcEngineerFieldIsUser: z.boolean().optional(),
    productManagerFieldIsUser: z.boolean().optional(),
    subtaskSquadFieldId: z.string().max(80).optional(),
    subtaskSquadOptionId: z.string().max(80).optional(),
  })
  .passthrough();

export const parseSquadJiraConfigWriteBody = (body: unknown) =>
  squadJiraConfigWriteSchema.parse(body);

export const jiraTasksArraySchema = z.object({
  tasks: z.array(taskSchema).min(1).max(maxTasks),
});

export const parseJiraTasksArrayBody = (body: unknown) => jiraTasksArraySchema.parse(body);

export const jiraSingleTaskSchema = z.object({
  task: taskSchema,
  plannerPeople: z
    .array(z.object({ name: z.string(), nickname: z.string().optional() }))
    .max(200)
    .optional(),
  plannerNames: z.array(z.string()).max(200).optional(),
});

export const parseJiraSingleTaskBody = (body: unknown) => jiraSingleTaskSchema.parse(body);

export const autoMapNamesSchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
});

export const parseAutoMapNamesBody = (body: unknown) => autoMapNamesSchema.parse(body);
