import "./styles.css";
import { IconSchool } from "@tabler/icons-react";
import type { IUIConfig } from "erxes-ui";
import manifest from "../../erxes.json" with { type: "json" };

// CONFIG.name is the public service/permission identity, including dashes.
// Only manifest.ui.remote is normalized for the federation container.
const { name, path } = manifest.ui;

// core-ui registers only `/<path>/*` for `./<name>`. This plugin owns its
// nested routes, sidebar and settings through AppLayout in Main.tsx.
export const CONFIG: IUIConfig = {
  name,
  path,
  // Advisory compatibility range read by current core-ui hosts.
  platform: "3.3.2",
  icon: IconSchool,
  navigationGroup: {
    name: manifest.title,
    icon: IconSchool,
    defaultPath: path,
  },
  modules: [{ name, icon: IconSchool, path }],
};
