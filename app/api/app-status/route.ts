import { appProtocolVersion, configurationId } from "../../../config/settings.mjs";
import build from "../../../config/build-info.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    appProtocolVersion,
    configId: configurationId,
    appVersion: build.version,
  });
}
