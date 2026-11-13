import { ensureTaskSchema } from "../../../../db/tasks";
import { listAreas } from "../../../../db/areas";
import { assertLocalMutation, errorResponse } from "../../../../lib/local-request";
import { parseAreaOrder, areaOrderStatements } from "../../../../lib/task-areas";

export async function PUT(request: Request) {
  try {
    assertLocalMutation(request);
    const d1=await ensureTaskSchema(),current=await listAreas(d1);
    const ids=parseAreaOrder(await request.json(),current.map(area=>area.id));
    const statements=areaOrderStatements(ids);
    if(statements.length)await d1.batch(statements.map(({sql,params})=>d1.prepare(sql).bind(...params)));
    return Response.json({areas:await listAreas(d1)});
  }catch(error){return errorResponse(error,"Unable to save area order.");}
}
