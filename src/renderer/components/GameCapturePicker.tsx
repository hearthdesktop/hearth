/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./gameCapturePicker.css";

import { classNameFactory } from "@vencord/types/api/Styles";
import { BaseText, Button, Card, Paragraph } from "@vencord/types/components";
import { ModalCloseButton, Modals, ModalSize, openModal } from "@vencord/types/utils";

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
        <Modals.ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <Modals.ModalHeader className={cl("header")}>
                <BaseText size="lg" weight="semibold" tag="h3" style={{ flexGrow: 1 }}>
                    Share a Game
                </BaseText>
                <ModalCloseButton className={cl("header-close-button")} onClick={close} />
            </Modals.ModalHeader>

            <Modals.ModalContent className={cl("modal")}>
                <Paragraph className={cl("hint")}>
                    These games are running with game capture enabled. Sharing one reads frames straight from the game
                    instead of the desktop, which is much easier on your framerate.
                </Paragraph>

                <div className={cl("list")}>
                    {games.map(game => (
                        <Card
                            key={game.exe}
                            className={cl("game")}
                            onClick={() => submit({ type: "game", exe: game.exe })}
                        >
                            <Paragraph className={cl("name")}>{game.exe}</Paragraph>
                        </Card>
                    ))}
                </div>
            </Modals.ModalContent>

            <Modals.ModalFooter className={cl("footer")}>
                {/* picking a game is the primary action, so the fallback stays quiet */}
                <Button variant="secondary" onClick={close}>
                    Cancel
                </Button>
                <Button variant="secondary" onClick={() => submit({ type: "desktop" })}>
                    Screen or Window Instead
                </Button>
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}

export function openGameCapturePicker(games: GameSource[]) {
    let didSubmit = false;
    return new Promise<GamePick>((resolve, reject) => {
        openModal(
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
                    if (!didSubmit) reject("Aborted");
                }
            }
        );
    });
}
