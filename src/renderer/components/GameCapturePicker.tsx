/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./gameCapturePicker.css";

import { classNameFactory } from "@vencord/types/api/Styles";
import { Card, Paragraph } from "@vencord/types/components";
import { closeModal, Modal, openModal } from "@vencord/types/webpack/common";

const cl = classNameFactory("vcd-game-picker-");

export interface GameSource {
    exe: string;
}

export type GamePick = { type: "game"; exe: string } | { type: "desktop" };

function ModalComponent({
    games,
    modalProps,
    submit,
    close
}: {
    games: GameSource[];
    modalProps: any;
    submit: (pick: GamePick) => void;
    close: () => void;
}) {
    return (
        <Modal
            {...modalProps}
            size="sm"
            title="Share a Game"
            // picking a game is the primary action, so the fallback stays quiet
            actions={[
                { text: "Cancel", variant: "secondary", onClick: close },
                { text: "Screen or Window Instead", variant: "secondary", onClick: () => submit({ type: "desktop" }) }
            ]}
        >
            <Paragraph className={cl("hint")}>
                These games are running with game capture enabled. Sharing one reads frames straight from the game
                instead of the desktop, which is much easier on your framerate.
            </Paragraph>

            <div className={cl("list")}>
                {games.map(game => (
                    <Card key={game.exe} className={cl("game")} onClick={() => submit({ type: "game", exe: game.exe })}>
                        <Paragraph className={cl("name")}>{game.exe}</Paragraph>
                    </Card>
                ))}
            </div>
        </Modal>
    );
}

export function openGameCapturePicker(games: GameSource[]) {
    let didSubmit = false;
    return new Promise<GamePick>((resolve, reject) => {
        const key = openModal(
            props => (
                <ModalComponent
                    games={games}
                    modalProps={props}
                    submit={pick => {
                        didSubmit = true;
                        props.onClose();
                        resolve(pick);
                    }}
                    close={() => {
                        props.onClose();
                        if (!didSubmit) reject("Aborted");
                    }}
                />
            ),
            {
                onCloseRequest() {
                    closeModal(key);
                    if (!didSubmit) reject("Aborted");
                }
            }
        );
    });
}
