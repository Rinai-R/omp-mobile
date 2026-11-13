import { z } from 'zod';
export declare const LOOPBACK_CHUNK_BYTES: number;
export declare const LOOPBACK_MAX_BODY_BYTES: number;
export declare const LOOPBACK_MAX_WS_BYTES: number;
export declare const LOOPBACK_MAX_CONNECTIONS = 16;
/** Every handle is local to one authenticated encrypted connection. No URL/host/DNS input. */
export declare const loopbackRequestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    op: z.ZodLiteral<"describe">;
}, z.core.$strict>, z.ZodObject<{
    method: z.ZodEnum<{
        GET: "GET";
        HEAD: "HEAD";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
        OPTIONS: "OPTIONS";
    }>;
    body: z.ZodOptional<z.ZodString>;
    port: z.ZodNumber;
    path: z.ZodString;
    headers: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>>;
    op: z.ZodLiteral<"http.open">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"http.read">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"close">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    protocols: z.ZodArray<z.ZodString>;
    port: z.ZodNumber;
    path: z.ZodString;
    headers: z.ZodArray<z.ZodTuple<[z.ZodString, z.ZodString], null>>;
    op: z.ZodLiteral<"ws.open">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"ws.read">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    op: z.ZodLiteral<"ws.send">;
    id: z.ZodString;
    data: z.ZodString;
    binary: z.ZodBoolean;
}, z.core.$strict>], "op">;
export type LoopbackRequest = z.infer<typeof loopbackRequestSchema>;
export interface LoopbackHttpHead {
    status: number;
    headers: Array<[string, string]>;
}
export interface LoopbackRead {
    data: string;
    done: boolean;
}
export interface LoopbackWsRead {
    messages: Array<{
        data: string;
        binary: boolean;
    }>;
    closed: boolean;
}
