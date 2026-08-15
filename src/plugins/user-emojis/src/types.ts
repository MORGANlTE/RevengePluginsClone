export type CommandName = "e" | "ed" | "esync" | "deleteemoji" | "stealemoji";[cite: 5]

export interface CommandMeta {
    id: string;[cite: 5]
    version: string;[cite: 5]
    name: CommandName;[cite: 5]
}

export interface DiscoveredApp {
    appId: string;[cite: 5]
    appName: string;[cite: 5]
    commands: Partial<Record<CommandName, CommandMeta>>;[cite: 5]
}

export interface AppEmoji {
    id: string;[cite: 5]
    name: string;[cite: 5]
    animated: boolean;[cite: 5]
}

export interface PluginStorage {
    selectedAppId: string;
    botPingToUserPing: boolean;
    emojis: AppEmoji[];
    apps: DiscoveredApp[];
}
