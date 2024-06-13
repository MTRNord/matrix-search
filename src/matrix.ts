//
// Events
//

interface PowerLevelsEventContent {
    /**
     * The power level required to ban. Default 50.
     */
    ban?: number;
    /**
     * A map of event types to the power level required to send them.
     */
    events?: {
        [eventType: string]: number;
    };
    /**
     * The power level required to send events in the room. Default 50.
     */
    events_default?: number;
    /**
     * The power level required to invite users to the room. Default 50.
     */
    invite?: number;
    /**
     * The power level required to kick users from the room. Default 50.
     */
    kick?: number;
    /**
     * The power level required to redact other people's events in the room. Default 50.
     */
    redact?: number;
    /**
     * The power level required to send state events in the room. Default 50.
     */
    state_default?: number;
    /**
     * A map of user IDs to power levels.
     */
    users?: {
        [userId: string]: number;
    };
    /**
     * The power level of users not listed in `users`. Default 0.
     */
    users_default?: number;
    /**
     * Power levels required to send certain kinds of notifications.
     */
    notifications?: {
        /**
         * The power level required to send "@room" notifications. Default 50.
         */
        room?: number;
    };
}

interface IEvent<T extends string, C> {
    type: T;
    event_id: string;
    content: C;
}

export interface IStateEvent<T extends string, C> extends IEvent<T, C> {
    state_key: string;
}

export type Received<E extends Event> = E & {
    content: E["content"] | Record<string, never> /* redacted */;
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
        } & (Record<string, never> | { format: "org.matrix.custom.html"; formatted_body: string })
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
    | IStateEvent<"im.vector.modular.widgets", Record<string, never> | WidgetContent>
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
    | IStateEvent<"m.room.power_levels", PowerLevelsEventContent>
    | IStateEvent<"m.room.topic", { topic: string }>
) & { type: T };

export type Event = MessageEvent | StateEvent;

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
