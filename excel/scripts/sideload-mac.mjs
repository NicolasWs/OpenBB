// Sideload the development manifest into Excel for Mac by copying it into Excel's
// "wef" folder, then restart Excel and pick the add-in under Home > Add-ins > My Add-ins.
import { copyFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

if (platform() !== "darwin") {
  console.error("sideload-mac only works on macOS. See README.md for Excel on the web.");
  process.exit(1);
}

const wef = join(homedir(), "Library/Containers/com.microsoft.Excel/Data/Documents/wef");
mkdirSync(wef, { recursive: true });
const target = join(wef, "openbb-excel-addin.manifest.xml");
copyFileSync(new URL("../manifest.xml", import.meta.url), target);
console.log(`Copied manifest to ${target}`);
console.log("Restart Excel, then open Home > Add-ins and choose 'OpenBB Data (self-hosted)'.");
