/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Card, ErrorBoundary, HeadingTertiary, Paragraph, TextButton } from "@vencord/types/components";
import type { PropsWithChildren } from "react";

function openIssueTracker() {
    window.open("https://github.com/hearthdesktop/hearth/issues", "_blank");
}

function Fallback() {
    return (
        <Card variant="danger">
            <HeadingTertiary>Something went wrong.</HeadingTertiary>
            <Paragraph>
                Please make sure Vencord and Hearth are fully up to date. If it keeps happening,{" "}
                <TextButton variant="link" onClick={openIssueTracker}>
                    report it on GitHub
                </TextButton>
            </Paragraph>
        </Card>
    );
}

export function SimpleErrorBoundary({ children }: PropsWithChildren<{}>) {
    return <ErrorBoundary fallback={Fallback}>{children}</ErrorBoundary>;
}
