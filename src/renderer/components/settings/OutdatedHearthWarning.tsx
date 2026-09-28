/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Card, HeadingTertiary, Paragraph } from "@vencord/types/components";
import { useAwaiter } from "@vencord/types/utils";

import { cl } from "./Settings";

export function OutdatedHearthWarning() {
    const [isOutdated] = useAwaiter(HearthNative.app.isOutdated);

    if (!isOutdated) return null;

    return (
        <Card variant="warning" className={cl("updater-card")}>
            <HeadingTertiary>Hearth is out of date!</HeadingTertiary>
            <Paragraph>Staying up to date is important for security and stability.</Paragraph>

            <Button onClick={() => HearthNative.app.openUpdater()} variant="secondary">
                Open Updater
            </Button>
        </Card>
    );
}
