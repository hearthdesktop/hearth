/*
 * Hearth, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, protocol } from "electron";

import { handleHearthStaticProtocol } from "./hearthStatic";
import { handleHearthAssetsProtocol } from "./userAssets";

// vesktop: stays for pages inside Discord, since Vencord's CSP only allows that scheme there
const SCHEMES = ["hearth", "vesktop"];

async function handleRequest(req: Request) {
    const url = new URL(req.url);

    switch (url.hostname) {
        case "assets":
            return handleHearthAssetsProtocol(url.pathname, req);
        case "static":
            return handleHearthStaticProtocol(url.pathname, req);
        default:
            return new Response(null, { status: 404 });
    }
}

app.whenReady().then(() => {
    for (const scheme of SCHEMES) protocol.handle(scheme, handleRequest);
});

protocol.registerSchemesAsPrivileged(
    SCHEMES.map(scheme => ({
        scheme,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }))
);
