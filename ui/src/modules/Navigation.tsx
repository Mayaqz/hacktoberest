import { IconPhoneCall, IconSchool, IconSettings } from "@tabler/icons-react";
// Root import on purpose: core-ui shares `erxes-ui` as a Module Federation
// singleton keyed on the bare specifier, so deep imports would bundle a second
// private copy instead of reusing the host's.
import { NavigationMenuLinkItem, Sidebar } from "erxes-ui";
import manifest from "../../../erxes.json" with { type: "json" };

export const Navigation = () => (
  <Sidebar.Group>
    <Sidebar.GroupContent>
      <Sidebar.Menu>
        <NavigationMenuLinkItem name="Өнөөдөр" icon={IconSchool} path={`/${manifest.ui.path}`} />
        <NavigationMenuLinkItem name="Дуудлага" icon={IconPhoneCall} path={`/${manifest.ui.path}/calls`} />
        <NavigationMenuLinkItem name="Тохиргоо" icon={IconSettings} path={`/${manifest.ui.path}/settings`} />
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
);
