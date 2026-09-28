/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setBadge } from "renderer/appBadge";

import { HearthSettingsSwitch } from "./HearthSettingsSwitch";
import { SettingsComponent } from "./Settings";

export const NotificationBadgeToggle: SettingsComponent = ({ settings }) => {
    return (
        <HearthSettingsSwitch
            title="Notification Badge"
            description="Show mention badge on the app icon"
            value={settings.appBadge}
            onChange={v => {
                settings.appBadge = v;
                if (v) setBadge();
                else HearthNative.app.setBadgeCount(0);
            }}
        />
    );
};
