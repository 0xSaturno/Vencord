/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { ChannelStore, GuildStore, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";

export interface TabData {
    name: string;
    url: string;
    channelId: string | null;
    guildId: string | null;
    selected: boolean;
}

export interface FavData {
    name: string;
    url: string;
    channelId: string | null;
    guildId?: string | null;
}

/**
 * Gets the human-readable name for the current channel/page
 */
export function getCurrentName(): string {
    const channelId = SelectedChannelStore.getChannelId();
    const guildId = SelectedGuildStore.getGuildId();

    if (channelId) {
        const channel = ChannelStore.getChannel(channelId);
        if (channel) {
            // DM Channel
            if (channel.isDM?.()) {
                const recipientId = channel.getRecipientId?.() as unknown as string;
                if (recipientId) {
                    const user = UserStore.getUser(recipientId);
                    return user ? `@${user.username}` : "Direct Message";
                }
            }
            // Group DM
            if (channel.isGroupDM?.()) {
                return channel.name || "Group DM";
            }
            // Guild channel
            if (channel.name) {
                return `#${channel.name}`;
            }
        }
    }

    if (guildId) {
        const guild = GuildStore.getGuild(guildId);
        if (guild) return guild.name;
    }

    // Fallback based on URL
    const path = location.pathname;
    if (path.includes("@me")) return "Friends";
    if (path.includes("store")) return "Store";
    if (path.includes("library")) return "Library";

    return "Discord";
}

/**
 * Gets the icon URL for a given pathname
 */
export function getIconUrl(url: string): string | null {
    const match = url.match(/^\/channels\/(\d+|@me|@favorites)\/(\d+)/);
    if (!match) return null;

    const [, guildIdOrMe, channelId] = match;
    const channel = ChannelStore.getChannel(channelId);

    if (!channel) return null;

    // DM - show recipient avatar
    if (channel.isDM?.()) {
        const recipientId = channel.getRecipientId?.() as unknown as string;
        if (recipientId) {
            const user = UserStore.getUser(recipientId);
            if (user) {
                // Try the method first, then construct CDN URL directly
                try {
                    const avatar = user.getAvatarURL?.(undefined, 20);
                    if (avatar) return avatar;
                } catch { /* ignore */ }
                // Direct CDN fallback
                if (user.avatar) {
                    return `https://cdn.discordapp.com/avatars/${recipientId}/${user.avatar}.webp?size=32`;
                }
            }
        }
    }

    // Guild channel - show guild icon
    if (guildIdOrMe !== "@me" && guildIdOrMe !== "@favorites") {
        const guild = GuildStore.getGuild(guildIdOrMe);
        if (guild) {
            // Try the method first
            try {
                const iconUrl = (guild as any).getIconURL?.(20, false);
                if (iconUrl) return iconUrl;
            } catch { /* ignore */ }
            // Direct CDN fallback using guild.icon hash
            if (guild.icon) {
                return `https://cdn.discordapp.com/icons/${guildIdOrMe}/${guild.icon}.webp?size=32`;
            }
        }
    }

    return null;
}


/**
 * Gets the first letter(s) for a fallback icon
 */
export function getIconFallback(name: string): string {
    if (name.startsWith("#")) return "#";
    if (name.startsWith("@")) return name.charAt(1).toUpperCase();
    return name.charAt(0).toUpperCase();
}

const STORE_PREFIX = "vc-channeltabs-";

export function saveData(key: string, data: any): void {
    const storeKey = `${STORE_PREFIX}${key}`;
    DataStore.set(storeKey, data).catch(e => {
        console.error("[ChannelTabs] Failed to save data:", e);
    });
}


/**
 * Loads data asynchronously from Vencord's DataStore.
 * Must be called during plugin initialization.
 */
export async function loadDataAsync<T>(key: string, defaultValue: T): Promise<T> {
    const storeKey = `${STORE_PREFIX}${key}`;
    try {
        const value = await DataStore.get(storeKey);
        if (value !== undefined && value !== null) {
            return value as T;
        }
    } catch (e) {
        console.error("[ChannelTabs] Failed to load data:", e);
    }
    return defaultValue;
}
