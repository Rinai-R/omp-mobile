export declare const NOISE_IK_PROTOCOL: "Noise_IK_25519_ChaChaPoly_SHA256";
export interface NoiseIkSessionOptions {
    role: 'initiator' | 'responder';
    localPrivateKey: string;
    localPublicKey: string;
    remotePublicKey: string;
    prologue: Uint8Array;
    random?: (length: number) => Uint8Array;
}
/**
 * A narrow DSH Remote wrapper around a maintained Noise framework.
 *
 * It intentionally exposes only the fixed v1 IK suite and verifies the
 * transcript's remote static key before transport messages can be used.
 */
export declare class NoiseIkSession {
    private handshake?;
    private readonly expectedRemoteStatic;
    private transport?;
    private destroyed;
    constructor(options: NoiseIkSessionOptions);
    get protocol(): typeof NOISE_IK_PROTOCOL;
    get complete(): boolean;
    get canWriteHandshake(): boolean;
    writeHandshake(payload?: Uint8Array<ArrayBuffer>): Uint8Array;
    readHandshake(message: Uint8Array): Uint8Array;
    encrypt(plaintext: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array): Uint8Array;
    sendingCounter(): bigint;
    receivingCounter(): bigint;
    destroy(): void;
    private finishIfReady;
    private verifyRemoteStatic;
    private assertHandshake;
    private assertLive;
}
export declare class NoiseSessionError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function createNoisePrologue(connectionId: string, hostDeviceId: string, clientDeviceId: string): Uint8Array;
