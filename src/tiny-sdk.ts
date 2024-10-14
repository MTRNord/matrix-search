/// A tiny sdk for matrix

import { GetRoomMessagesRequest, GetRoomMessagesResponse, Received, RoomEventFilter } from "./matrix.js";
import got from "got";
import {
    DeviceId,
    DeviceLists,
    KeysBackupRequest,
    KeysClaimRequest,
    KeysQueryRequest,
    KeysUploadRequest,
    OlmMachine,
    RequestType,
    RoomId,
    RoomMessageRequest,
    SignatureUploadRequest,
    StoreType,
    ToDeviceRequest,
    UserId
} from "@matrix-org/matrix-sdk-crypto-nodejs";
import { readFileSync, writeFileSync } from "node:fs";

export const directions = { forward: "f", reverse: "b" } as const;

export type WhoAmIResponse = {
    device_id?: string;
    user_id: string;
    is_guest?: boolean;
}

export class MatrixClient {
    private userId?: UserId;
    private deviceId?: DeviceId;
    public olmMachine?: OlmMachine;
    private syncRunning: boolean = true;
    private roomNameCache: Record<string, string | boolean> = {};

    constructor(private homeserver: string, private token: string) { }

    async start() {
        console.log("Starting client");
        const whoami = await this.whoami();
        console.log(`Logged in as ${whoami.user_id}`);

        this.userId = new UserId(whoami.user_id);

        // Use the existing id or a random one to create a new DeviceId object
        // 1. check if we have a device_id
        // 2. if we don't, create a random string
        // 3. create a new DeviceId object
        const device_id = whoami.device_id ?? Math.random().toString(36).substring(7);
        console.log(`Device ID: ${device_id}`);
        this.deviceId = new DeviceId(device_id);

        this.olmMachine = await OlmMachine.initialize(this.userId, this.deviceId, "./storage/crypto", undefined, StoreType.Sqlite);

        console.log("Client started")
    }

    // Reads the storage/bot.json for the syncToken field.
    // Also handle the case where the file doesn't exist.
    getSyncTokenFromStorage(): { syncToken?: string, previous?: string } | undefined {
        try {
            const file = readFileSync("./storage/bot.json", "utf-8");
            const json = JSON.parse(file);
            const syncToken = json.syncToken as string | undefined;
            const previous = json.previous as string | undefined;
            return { syncToken, previous };
        } catch (e) {
            return undefined;
        }
    }

    // Writes the syncToken to the storage/bot.json
    // Ensure we dont fail if the file doesn't exist
    setSyncTokenToStorage(syncToken: string, previous?: string) {
        console.log("Setting sync token to", syncToken);
        try {
            writeFileSync("./storage/bot.json", JSON.stringify({ syncToken, previous }), { flush: true });
        } catch (e) {
            console.error("Failed to write sync token", e);
            process.exit(1);
        }
    }

    async * sync(): AsyncGenerator<[string, Record<string, any>], void, void> {
        if (!this.olmMachine || !this.token) {
            throw new Error("Client not started");
        }
        while (this.syncRunning) {
            let url = "/_matrix/client/v3/sync";
            const tokens = this.getSyncTokenFromStorage();
            console.log("Syncing with token", tokens?.syncToken);
            if (tokens?.syncToken) {
                url += `?since=${tokens.syncToken}`;
            }

            let syncResp: Record<string, any>;
            try {
                syncResp = await this.getRequest(url, {}, 30 * 1000);
                console.log("Got sync response");
            } catch (e) {
                console.error("Failed to sync", e);
                continue;
            }

            const toDeviceEvents: Record<string, any>[] | undefined = syncResp.to_device?.events;
            const oneTimeKeyCounts: Record<string, number> = syncResp.device_one_time_keys_count;
            const unusedFallbackKeys: Array<string> = syncResp.device_unused_fallback_key_types;
            const leftDevices: UserId[] | undefined = syncResp.device_lists?.left?.map((u: string) => new UserId(u));
            const changedDevices: UserId[] | undefined = syncResp.device_lists?.changed?.map((u: string) => new UserId(u));


            const deviceList = new DeviceLists(changedDevices, leftDevices);
            await this.olmMachine.receiveSyncChanges(
                JSON.stringify(toDeviceEvents) ?? "[]",
                deviceList,
                oneTimeKeyCounts,
                unusedFallbackKeys,
            );

            const outgoingRequests = await this.olmMachine.outgoingRequests();
            // Send outgoing requests
            for (const request of outgoingRequests) {
                // Switch on the request type
                try {
                    switch (request.type) {
                        case RequestType.KeysUpload: {
                            const keysUploadRequest = request as KeysUploadRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/upload", {}, keysUploadRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysBackup: {
                            const keysBackupRequest = request as KeysBackupRequest;
                            const resp = await this.putRequest("/_matrix/client/v3/room_keys/keys", {}, keysBackupRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysClaim: {
                            const keysClaimRequest = request as KeysClaimRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/claim", {}, keysClaimRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysQuery: {
                            const keysQueryRequest = request as KeysQueryRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/query", {}, keysQueryRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.SignatureUpload: {
                            const signatureUploadRequest = request as SignatureUploadRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/signatures/upload", {}, signatureUploadRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.ToDevice: {
                            const toDeviceRequest = request as ToDeviceRequest;
                            const resp = await this.postRequest(`/_matrix/client/v3/sendToDevice/${toDeviceRequest.eventType}/${toDeviceRequest.txnId}`, {}, toDeviceRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.RoomMessage: {
                            const roomMessageRequest = request as RoomMessageRequest;
                            const resp = await this.postRequest(`/_matrix/client/v3/rooms/${roomMessageRequest.roomId}/send/${roomMessageRequest.eventType}/${roomMessageRequest.txnId}`, {}, roomMessageRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        default:
                            console.error("Unknown request type", request);
                    }
                } catch (e) {
                    console.error("Failed to send request", e);
                    // We retry
                    continue;
                }
            }

            // Save the sync token
            console.log("Next:", syncResp.next_batch as string, "Current:", tokens?.syncToken);
            this.setSyncTokenToStorage(syncResp.next_batch as string, tokens?.syncToken);

            if (syncResp.next_batch === tokens?.previous || syncResp.next_batch === tokens?.syncToken) {
                // We already synced this token
                console.log("Already synced this token, waiting for new events");
                continue;
            }

            // decrypt all events here. for our usecase we only care about joined rooms
            syncResp.rooms.join = await this.decryptTimeline(syncResp);

            // parse new events from the sync response
            const joinedRooms = syncResp.rooms.join as Record<string, any>;

            // Loop over the joined rooms object (we need the key which is the room id and the events within)
            for (const [roomId, room] of Object.entries(joinedRooms)) {
                // Loop over the events in the room
                for (const event of room.timeline.events) {
                    yield [roomId, event];
                }
            }
        }
    }

    private async decryptTimeline(syncResp: any) {
        const decryptedEvents: Record<string, Record<string, any>[]> = {};
        for (const [roomId, room] of Object.entries(syncResp.rooms.join as Record<string, any>)) {
            const decryptedRoom = await this.decryptListOfEvents(room.timeline.events as Record<string, any>[], roomId);
            decryptedEvents[roomId] = decryptedRoom;
        }
        return decryptedEvents;
    }

    async decryptListOfEvents(events: Record<string, any>[], roomId: string): Promise<Record<string, any>[]> {
        return await Promise.all(events.map(async (event) => {
            return await this.decryptEvent(event, roomId);
        }));
    }

    async decryptEvent(event: Record<string, any>, roomId: string): Promise<Record<string, any>> {
        if (event.type === "m.room.encrypted") {
            const members = await this.getRoomMembers(roomId, ['join', 'invite']);
            await this.addTrackedUsers(members.map(e => e["state_key"] as string))
            try {
                const rawEvent = await this.olmMachine?.decryptRoomEvent(JSON.stringify(event), new RoomId(roomId));
                if (rawEvent) {
                    event = JSON.parse(rawEvent.event);
                    return event;
                } else {
                    console.warn("Failed to decrypt event1", event);
                    return event;
                }
            } catch (e) {
                console.warn("Failed to decrypt event2", e);
                return event;
            }
        }
        return event;
    }
    private async getRoomMembers(roomId: string, membership: string[]) {
        const resp: { chunk: Record<string, any>[]; } = await this.getRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`, { membership }, 30 * 1000);
        return resp.chunk;
    }


    async whoami(): Promise<WhoAmIResponse> {
        return await this.getRequest("/_matrix/client/v3/account/whoami", {}, 30 * 1000) as WhoAmIResponse;
    }

    async sendFile(roomId: string, event_id: string, body: string, file: Buffer) {
        // Upload with authenticated media endpoint
        const mediaResponse = await this.postRequest(`/_matrix/media/v3/upload?filename=${encodeURIComponent(roomId.replaceAll("!", "").replaceAll(":", "_"))}.pdf`, {}, file, 30 * 1000, "application/pdf");
        const mediaUrl = mediaResponse.content_uri;

        // Send a notice to the room telling the user the file is ready
        const content = {
            msgtype: "m.notice",
            body: body,
            "m.relates_to": {
                "m.in_reply_to": {
                    event_id: event_id
                }
            }
        };

        const txnId = `${Date.now()}-${Math.random()}`;

        await this.putRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`, {}, JSON.stringify(content).toString(), 30 * 1000);

        // Send file to the room
        const txnId2 = `${Date.now()}-${Math.random()}`;

        const fileContent = {
            msgtype: "m.file",
            body: `${roomId.replaceAll("!", "").replaceAll(":", "_")}.pdf`,
            url: mediaUrl,
            info: {
                mimetype: "application/pdf",
                size: file.length
            }
        };
        await this.putRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId2)}`, {}, JSON.stringify(fileContent), 30 * 1000);
    }

    async redactEvent(roomId: string, eventId: string, reason?: string) {
        await this.postRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}`, {}, JSON.stringify({ reason }), 30 * 1000);
    }

    // Fetches the room name from the cache or the server
    async getRoomName(roomId: string): Promise<string | undefined> {
        if (typeof this.roomNameCache[roomId] === "string") {
            return this.roomNameCache[roomId] as string;
        } else if (this.roomNameCache[roomId] === false) {
            return;
        }

        try {
            const room_name_resp = await this.getRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`, {}, 30 * 1000);
            const room_name = room_name_resp.name;
            if (room_name) {
                this.roomNameCache[roomId] = room_name;
                return room_name as string;
            }
        } catch {
            this.roomNameCache[roomId] = false;
            return;
        }
    }

    async getRequest(path: string, query: Record<string, any>, timeout: number): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return got.get(`${this.homeserver}${path}`, {
            searchParams: query, timeout: {
                request: timeout
            }, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async postRequest(path: string, query: Record<string, any>, body: string | Buffer, timeout: number, content_type = "application/json"): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return await got.post(`${this.homeserver}${path}`, {
            searchParams: query, body, timeout: {
                request: timeout
            }, headers: { "Content-Type": content_type, "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async putRequest(path: string, query: Record<string, any>, body: string, timeout: number, content_type = "application/json"): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return await got.put(`${this.homeserver}${path}`, {
            searchParams: query, body, timeout: {
                request: timeout
            }, headers: { "Content-Type": content_type, "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async getJoinedRooms(): Promise<string[]> {
        const response = await this.getRequest("/_matrix/client/v3/joined_rooms", {}, 30 * 1000);
        return response.joined_rooms as string[];
    }

    async * getRoomEvents(
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
                    response = await this.getRequest(path, query, 120 * 1000);
                    break;
                } catch (e) {
                    console.error("Failed to get messages, retrying", e);
                    // Wait 1s before retrying
                    await new Promise((resolve) => setTimeout(resolve, 1000));
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

    private async addTrackedUsers(users: string[]) {
        const uids = users.map((u) => new UserId(u));
        await this.olmMachine?.updateTrackedUsers(uids);

        const keysClaim = await this.olmMachine?.getMissingSessions(uids);
        if (keysClaim) {
            const keysClaimRequest = keysClaim;
            const resp = await this.postRequest("/_matrix/client/v3/keys/claim", {}, keysClaimRequest.body, 30 * 1000);
            await this.olmMachine?.markRequestAsSent(keysClaim.id, keysClaim.type, JSON.stringify(resp));
        }
    }

    // // MAS specific login
    // async masLogin() {
    //     const auth_issuer_resp: { issuer: string } = await got.get(`${this.homeserver}/_matrix/client/unstable/org.matrix.msc2965/auth_issuer`).json();
    //     const issuer = auth_issuer_resp.issuer;

    //     const openid_config: { token_endpoint: string; device_authorization_endpoint: string; registration_endpoint: string; } = await got.get(issuer + "/.well-known/openid-configuration").json();
    //     const token_endpoint = openid_config.token_endpoint;
    //     const device_authorization_endpoint = openid_config.device_authorization_endpoint;
    //     const registration_endpoint = openid_config.registration_endpoint;

    //     // Register a client with `urn:ietf:params:oauth:grant-type:device_code` and `refresh_token` grant types
    //     const request = {
    //         application_type: "native",
    //         client_name: "Matrix Search",
    //         grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    //         response_types: [],
    //         token_endpoint_auth_method: "none"
    //     };
    //     const client_data: { client_id: string; } = await got.post(registration_endpoint, {
    //         json: request
    //     }).json();

    //     // Get a device code
    //     const deviceID = Math.random().toString(36).substring(7);
    //     const device_code_resp = await got.post(device_authorization_endpoint, {
    //         json: {
    //             client_id: client_data.client_id,
    //             scope: `urn:matrix:org.matrix.msc2967.client:api:* urn:matrix:org.matrix.msc2967.client:device:${deviceID}`
    //         }
    //     }).json();
    // }
}