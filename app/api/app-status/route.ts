import { appProtocolVersion, configurationId } from "../../../config/settings.mjs";
import { version } from "../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    appProtocolVersion,
    configId: configurationId,
    appVersion: version,
  });
}
