import type {
    MatrixError, PowerLevelsEventContent as PowerLevels,
    RoomCreateOptions as RoomCreateFullOptions,
} from "matrix-bot-sdk";

export interface RoomCreateOptions extends RoomCreateFullOptions {
    preset?: Exclude<NonNullable<RoomCreateFullOptions["preset"]>, "trusted_private_chat">;
}

//
// Events
//

interface IEvent<T extends string, C> {
    type: T;
    event_id: string;
    content: C;
}

export interface IStateEvent<T extends string, C> extends IEvent<T, C> {
    state_key: string;
}

export type Received<E extends Event> = E & {
    content: E["content"] | {} /* redacted */;
    origin_server_ts: number;
    room_id: string;
    sender: string;
};

export type MessageEvent<T = unknown> = (
    | IEvent<
        "m.reaction",
        { "m.relates_to": { rel_type: "m.annotation"; event_id: string; key: string } }
    >
    | IEvent<
        "m.room.message",
        {
            body: string;
            msgtype: "m.notice" | "m.text";
            "m.relates_to"?: { rel_type: "m.replace"; event_id: string };
        } & ({} | { format: "org.matrix.custom.html"; formatted_body: string })
    >
    | (IEvent<"m.room.redaction", { reason?: string }> & { redacts: string })
) & { type: T };

type WidgetContent = {
    creatorUserId: string;
    name: string;
    avatar_url?: string;
} & (
        | { type: "customwidget"; url: string }
        | {
            type: "jitsi";
            url: string;
            data: { domain: string; conferenceId: string; roomName: string };
        }
    );

export type StateEvent<T = unknown> = (
    | IStateEvent<"im.vector.modular.widgets", {} | WidgetContent>
    | IStateEvent<
        "io.element.widgets.layout",
        {
            widgets: Record<
                string,
                { index: number; container: "top"; height: number; width: number }
            >;
        }
    >
    | IStateEvent<"m.room.avatar", { url: string }>
    | IStateEvent<"m.room.canonical_alias", { alias: string; alt_aliases?: string[] }>
    | IStateEvent<"m.room.guest_access", { guest_access: "can_join" | "forbidden" }>
    | IStateEvent<
        "m.room.history_visibility",
        { history_visibility: "invited" | "joined" | "shared" | "world_readable" }
    >
    | IStateEvent<
        "m.room.join_rules",
        | { join_rule: "invite" | "knock" | "private" | "public" }
        | {
            join_rule: "knock_restricted" | "restricted";
            allow: { type: "m.room_membership"; room_id: string }[];
        }
    >
    | IStateEvent<
        "m.room.member",
        { membership: "ban" | "invite" | "join" | "knock" | "leave" }
    >
    | IStateEvent<"m.room.name", { name: string }>
    | IStateEvent<"m.room.power_levels", PowerLevels>
    | IStateEvent<"m.room.topic", { topic: string }>
) & { type: T };

export type Event = MessageEvent | StateEvent;

export type StateEventInput = Omit<StateEvent, "event_id" | "sender" | "state_key"> &
    Partial<Pick<StateEvent, "state_key">>;

//
// Client API
//

export interface GetRoomMessagesRequest {
    dir: "b" | "f";
    filter?: string; // RoomEventFilter
    from?: string;
}

export interface GetRoomMessagesResponse {
    chunk: Received<Event>[];
    end?: string;
}

export interface RoomEventFilter {
    not_senders?: string[];
    not_types?: string[];
    senders?: string[];
    types?: string[];
}

export interface Sync {
    rooms?: {
        join?: {
            [id: string]: {
                state: { events: Received<StateEvent>[] };
                timeline: { events: Received<Event>[] };
            };
        };
    };
}

// Workaround for turt2live/matrix-bot-sdk#197
export const orNone = (error: MatrixError) => {
    if (error.errcode === "M_NOT_FOUND") return undefined;

    throw error;
};

//
// Server constants
//

const defaultState: Record<string, StateEvent["content"]> = {
    "m.room.guest_access/": { guest_access: "forbidden" },
};

export const moderatorLevel = 50;

// As at https://github.com/matrix-org/synapse/blob/v1.67.0/synapse/handlers/room.py#L123
export const resolvePreset = (
    preset: RoomCreateOptions["preset"]
): Pick<RoomCreateOptions, "initial_state"> => {
    switch (preset) {
        case undefined:
            return {};
        case "public_chat":
            return {
                initial_state: [
                    { type: "m.room.guest_access", content: { guest_access: "forbidden" } },
                    {
                        type: "m.room.history_visibility",
                        content: { history_visibility: "shared" },
                    },
                    { type: "m.room.join_rules", content: { join_rule: "public" } },
                ],
            };
        case "private_chat":
            return {
                initial_state: [
                    { type: "m.room.guest_access", content: { guest_access: "can_join" } },
                    {
                        type: "m.room.history_visibility",
                        content: { history_visibility: "shared" },
                    },
                    { type: "m.room.join_rules", content: { join_rule: "invite" } },
                ],
            };
        default:
            throw new Error(`Not implemented for preset ${preset}`);
    }
};

//
// Helpers
//

export const isStateEvent = (event: Event): event is StateEvent => "state_key" in event;

export const isUserId = (text: string): boolean => /^@[-.\w]+:[-.\w]+$/.test(text);

export const permalinkPattern = /https:\/\/matrix\.to\/#\/([!#@][-.\w]+:[-.\w]+)/;
