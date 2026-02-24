/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, screen } from "electron";

export interface NativeDisplayInfo {
    id: number;
    label: string;
    bounds: { x: number; y: number; width: number; height: number; };
}

export interface NativeCursorInfo {
    x: number;
    y: number;
    displayId: number;
}

/**
 * Gets the current cursor position and which display it's on.
 * Runs in the main process where Electron's `screen` module is available.
 */
export function getCursorInfo(_: IpcMainInvokeEvent): NativeCursorInfo {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    return {
        x: point.x,
        y: point.y,
        displayId: display.id,
    };
}

/**
 * Gets all connected displays with their bounds.
 */
export function getAllDisplays(_: IpcMainInvokeEvent): NativeDisplayInfo[] {
    return screen.getAllDisplays().map(d => ({
        id: d.id,
        label: d.label,
        bounds: d.bounds,
    }));
}
