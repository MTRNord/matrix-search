import { MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider, RustSdkCryptoStoreType } from "matrix-bot-sdk";
import Indexer from "./indexer.js";
import Config from "./config.js";
import { GetRoomMessagesRequest, GetRoomMessagesResponse, Received, RoomEventFilter } from "./matrix.js";
import fs from "node:fs";

// Just a small wrapper for the cache
class Room {
    constructor(public room_id: string, public room_name: string) { }
}

const room_id_room_name_cache: Room[] = [];

const directions = { forward: "f", reverse: "b" } as const;
// Pending https://github.com/turt2live/matrix-bot-sdk/issues/250
async function* getRoomEvents(
    client: MatrixClient,
    room: string,
    direction: "forward" | "reverse",
    filter?: RoomEventFilter
): AsyncGenerator<Received<any>[], void, void> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/messages`;
    const base: GetRoomMessagesRequest = {
        ...(direction && { dir: directions[direction] }),
        ...(filter && { filter: JSON.stringify(filter) }),
    };

    let from: string | undefined;
    do {
        const query: GetRoomMessagesRequest = { ...base, ...(from && { from }) };

        // We request but try at least 5 times
        let response: GetRoomMessagesResponse | undefined = undefined;
        for (let i = 0; i < 15; i++) {
            try {
                response = await client.doRequest("GET", path, query, null, 120 * 1000);
                break;
            } catch (e) {
                console.error("Failed to get messages, retrying", e);
            }
        }

        if (!response) {
            console.error("Failed to get messages");
            break;
        }
        from = response.end;
        yield response.chunk;
    } while (from);
}

// Ensures no matrix IDs are in the content.body
function cleanContent(content: Record<string, any>) {
    if (typeof content !== "object") return content;
    if (content.body) {
        content.body = content.body.replace(/@[a-zA-Z0-9_\-.=]+:[a-zA-Z0-9\-.]+/g, "<mxid>");
    }
    return content;
}

type BackfillState = {
    rooms: string[];
};

async function backfill(client: MatrixClient, indexer: Indexer) {
    // Check if we have a state file
    const filePath = "./storage/backfillState.json";
    if (!fs.existsSync(filePath)) {
        console.info("No backfill state found, writing empty state file");
        fs.writeFileSync(filePath, "{\"rooms\":[]}");
    }

    const stateJson = fs.readFileSync(filePath, "utf-8");
    const state: BackfillState = JSON.parse(stateJson);

    console.info("Indexing existing messages")
    const joined_rooms = await client.getJoinedRooms();

    // Remvoe rooms we've already indexed.
    // The already indexed are a list of strings in the rooms object on our state
    const newRooms = joined_rooms.filter(room => !state.rooms.includes(room));

    // Save the state file
    fs.writeFileSync(filePath, JSON.stringify(state));

    const editedEvents: string[] = [];

    for (const room of newRooms) {
        const pages = getRoomEvents(client, room, "reverse", { types: ["m.room.message"] });
        for await (const page of pages) {
            for (const event of page) {
                if (editedEvents.includes(event["event_id"] as string)) {
                    continue;
                }
                if (event.content["m.relates_to"]) {
                    if (event.content["m.relates_to"].rel_type === "m.replace") {
                        editedEvents.push(event.content["m.relates_to"].event_id as string);
                    }
                }

                if (await client.crypto.isRoomEncrypted(room)) {
                    await client.crypto.onRoomEvent(room, event);
                } else {
                    await handleMessages(indexer, client, room, event)
                }
            }
        }

        // Add the room to the state and save it
        state.rooms.push(room);
        fs.writeFileSync(filePath, JSON.stringify(state));
    }
}

function normalizeEventId(eventId: string) {
    return eventId.replace("$", "").replace(":", "_").replace(".", "_");
}

function convertEventToDocument(event: any, roomId: string, room_name?: string | null) {
    const doc: {
        id: string,
        sender: string,
        content: any,
        room_id: string,
        origin_server_ts: string,
        room_name?: string
    } = {
        id: normalizeEventId(event["event_id"] as string),
        sender: event["sender"],
        content: cleanContent(event["content"] as Record<string, any>),
        room_id: roomId,
        origin_server_ts: event["origin_server_ts"],
    }
    if (room_name) {
        doc.room_name = room_name
    }

    return doc
}

async function handleMessages(indexer: Indexer, client: MatrixClient, roomId: string, event: any) {
    if (event["content"]["msgtype"] === "m.text") {
        console.info(`Received message in room ${roomId}`);
        if (event.content["m.relates_to"]) {
            if (event.content["m.relates_to"].rel_type === "m.replace") {
                console.info(`Removing original event ${event.content["m.relates_to"].event_id}`);
                await indexer.delete(normalizeEventId(event.content["m.relates_to"].event_id as string));
            }
        }

        const room = room_id_room_name_cache.find((room) => room.room_id === roomId);
        let room_name: string;
        if (room === undefined) {
            try {
                console.log("searching room_name")
                room_name = (await client.getRoomStateEvent(roomId, "m.room.name", ''))["name"];
                if (room_name) {
                    console.log("found room_name")
                    room_id_room_name_cache.push(new Room(roomId, room_name));
                }
            } catch (e) {
                console.log("not found room_name")
            }
        } else {
            console.log("used existing room_name")
            room_name = room.room_name;
        }
        const res = await indexer.insert(convertEventToDocument(event, roomId, room_name));
        console.info(`Indexed message:`, res);
    }
}

async function run() {
    const storageProvider = new SimpleFsStorageProvider("./storage/bot.json");
    const cryptoProvider = new RustSdkCryptoStorageProvider("./storage/crypto", RustSdkCryptoStoreType.Sqlite);

    const config = new Config();
    const homeserverUrl = config.homeserverUrl;
    const accessToken = config.accessToken;
    const indexer = new Indexer();

    const client = new MatrixClient(homeserverUrl, accessToken, storageProvider, cryptoProvider);

    client.on("room.message", (roomId: string, event: Record<string, any>) => void handleMessages(indexer, client, roomId, event));

    await client.start();
    console.info("Bot started!");

    await backfill(client, indexer);

}

await run();