import {
  ensureTaskSchema,
  parseTaskId,
} from "../../../../db/tasks";
import { assertLocalMutation } from "../../../../lib/local-request";

const ACTIVE_STATUSES = [
  "now",
  "waiting",
  "later",
  "confirmation",
] as const;

type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

function parseColumns(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const columns = {} as Record<ActiveStatus, number[]>;
  const seen = new Set<number>();

  for (const status of ACTIVE_STATUSES) {
    if (!Array.isArray(record[status])) return null;
    const ids: number[] = [];
    for (const rawId of record[status]) {
      const id = parseTaskId(String(rawId));
      if (!id || seen.has(id)) return null;
      seen.add(id);
      ids.push(id);
    }
    columns[status] = ids;
  }

  return { columns, seen };
}

export async function POST(request: Request) {
  try {
    assertLocalMutation(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const parsed = parseColumns(payload.columns);
    if (!parsed) {
      return Response.json(
        { error: "The card order is invalid." },
        { status: 400 }
      );
    }

    const d1 = await ensureTaskSchema();
    const activeResult = await d1
      .prepare("SELECT id FROM tasks WHERE archived = 0 AND source = 'manual'")
      .all<{ id: number }>();
    const activeIds = (activeResult.results ?? []).map((row) => row.id);
    if (
      activeIds.length !== parsed.seen.size ||
      activeIds.some((id) => !parsed.seen.has(id))
    ) {
      return Response.json(
        { error: "The board changed while you were dragging. Refresh and try again." },
        { status: 409 }
      );
    }

    const statements = ACTIVE_STATUSES.flatMap((status) =>
      parsed.columns[status].map((id, index) =>
        d1
          .prepare(
            `UPDATE tasks
             SET status = ?,
                 manual_order = ?,
                 archived = 0,
                 completed_at = NULL
             WHERE id = ? AND source = 'manual'`
          )
          .bind(status, index, id)
      )
    );
    if (statements.length) await d1.batch(statements);

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save the card order";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertLocalMutation(request);
    const d1 = await ensureTaskSchema();
    await d1
      .prepare("UPDATE tasks SET manual_order = NULL WHERE archived = 0 AND source = 'manual'")
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reset the card order";
    return Response.json({ error: message }, { status: 500 });
  }
}
