/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from "@vencord/types/webpack/common";

import { HearthSettingsSwitch } from "./HearthSettingsSwitch";
import { SettingsComponent } from "./Settings";

export const AutoStartToggle: SettingsComponent = ({ settings }) => {
    const [autoStartEnabled, setAutoStartEnabled] = useState(HearthNative.autostart.isEnabled());

    return (
        <>
            <HearthSettingsSwitch
                title="Start With System"
                description="Automatically start Hearth on computer start-up"
                value={autoStartEnabled}
                onChange={async v => {
                    await HearthNative.autostart[v ? "enable" : "disable"]();
                    setAutoStartEnabled(v);
                }}
            />

            <HearthSettingsSwitch
                title="Auto Start Minimized"
                description={"Start Hearth minimized when starting with system"}
                value={settings.autoStartMinimized}
                onChange={v => (settings.autoStartMinimized = v)}
                disabled={!autoStartEnabled}
            />
        </>
    );
};
