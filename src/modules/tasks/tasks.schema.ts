import { z } from "zod";

const TaskStatusEnum = z.enum([
  "not_started",
  "in_progress",
  "completed",
  "waiting",
  "deferred",
]);

const TaskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

const TaskRelatedToTypeEnum = z.enum([
  "none",
  "organization",
  "contact",
  "lead",
  "opportunity",
]);

const TaskRepeatEnum = z.enum(["none", "daily", "weekly", "monthly", "yearly"]);

const TaskBaseSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(255),
  description: z.string().trim().max(5000).nullable().optional(),

  status: TaskStatusEnum.default("not_started"),
  priority: TaskPriorityEnum.default("medium"),

  start_date: z.string().datetime(),
  end_date: z.string().datetime(),

  assigned_to: z.string().uuid().nullable().optional(),

  related_to_type: TaskRelatedToTypeEnum.default("none"),
  related_to_id: z.string().uuid().nullable().optional(),

  repeat_task: TaskRepeatEnum.default("none"),
  repeat_task_end: z.string().date().nullable().optional(),

  task_duration_minutes: z.number().int().min(0).nullable().optional(),
});

export const CreateTaskSchema = TaskBaseSchema.superRefine((data, ctx) => {
  const start = new Date(data.start_date).getTime();
  const end = new Date(data.end_date).getTime();

  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "End date must be after start date",
    });
  }

  if (data.related_to_type === "none" && data.related_to_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["related_to_id"],
      message: "related_to_id must be null when related_to_type is none",
    });
  }

  if (data.related_to_type !== "none" && !data.related_to_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["related_to_id"],
      message: "Please provide related_to_id",
    });
  }

  if (data.repeat_task === "none" && data.repeat_task_end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repeat_task_end"],
      message: "repeat_task_end is not allowed when repeat_task is none",
    });
  }
});

export const UpdateTaskSchema = TaskBaseSchema.partial().superRefine(
  (data, ctx) => {
    if (data.start_date && data.end_date) {
      const start = new Date(data.start_date).getTime();
      const end = new Date(data.end_date).getTime();

      if (end < start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["end_date"],
          message: "End date must be after start date",
        });
      }
    }

    if (data.related_to_type === "none" && data.related_to_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["related_to_id"],
        message: "related_to_id must be null when related_to_type is none",
      });
    }

    if (data.repeat_task === "none" && data.repeat_task_end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repeat_task_end"],
        message: "repeat_task_end is not allowed when repeat_task is none",
      });
    }
  },
);

export const GetTasksSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  assigned_to: z.string().uuid().optional(),
  related_to_type: TaskRelatedToTypeEnum.optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type GetTasksInput = z.infer<typeof GetTasksSchema>;
