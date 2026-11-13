/**
 * Environment-agnostic RTC peer-connection surface.
 *
 * The transport state machine only talks to these narrow interfaces so the
 * browser native `RTCPeerConnection` and a future Node host backend can both
 * provide the underlying peer connection without the business code depending
 * on a specific RTC implementation (webrtc-implementation-plan.md §6.1/§6.2).
 */
export const RTC_DATA_CHANNEL_LABEL = 'dsh';
export const RTC_DATA_CHANNEL_OPTIONS = { ordered: true };
/**
 * Default browser-backed factory. This module is the only place in the webrtc
 * package that references the DOM `RTCPeerConnection` global, so Node hosts
 * inject their own factory and never import browser natives.
 */
export function browserRtcFactory() {
    return {
        create(configuration) {
            // `any` keeps the DOM handler `this`/event typing out of the adapter.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = new RTCPeerConnection({
                iceServers: configuration.iceServers,
                iceTransportPolicy: configuration.iceTransportPolicy,
            });
            return {
                get connectionState() { return raw.connectionState; },
                get iceConnectionState() { return raw.iceConnectionState; },
                get iceGatheringState() { return raw.iceGatheringState; },
                get signalingState() { return raw.signalingState; },
                set onconnectionstatechange(value) { raw.onconnectionstatechange = value; },
                get onconnectionstatechange() { return raw.onconnectionstatechange; },
                set oniceconnectionstatechange(value) { raw.oniceconnectionstatechange = value; },
                get oniceconnectionstatechange() { return raw.oniceconnectionstatechange; },
                set onicegatheringstatechange(value) { raw.onicegatheringstatechange = value; },
                get onicegatheringstatechange() { return raw.onicegatheringstatechange; },
                set onicecandidate(value) { raw.onicecandidate = value; },
                get onicecandidate() { return raw.onicecandidate; },
                set ondatachannel(value) { raw.ondatachannel = value; },
                get ondatachannel() { return raw.ondatachannel; },
                createDataChannel(label, options) { return adaptDataChannel(raw.createDataChannel(label, options)); },
                createOffer() { return raw.createOffer(); },
                createAnswer() { return raw.createAnswer(); },
                setLocalDescription(description) { return raw.setLocalDescription(description); },
                setRemoteDescription(description) { return raw.setRemoteDescription(description); },
                addIceCandidate(candidate) { return raw.addIceCandidate(candidate); },
                async getStats() { return await raw.getStats(); },
                close() { raw.close(); },
            };
        },
    };
}
export function summarizeIceCandidate(candidate) {
    const value = candidate?.candidate?.trim();
    if (value === undefined || value.length === 0)
        return emptyCandidateSummary();
    const parts = value.replace(/^candidate:/, '').split(/\s+/);
    const typeIndex = parts.indexOf('typ');
    const relatedAddressIndex = parts.indexOf('raddr');
    return {
        candidateType: parseCandidateType(parts[typeIndex + 1]),
        protocol: normalizeProtocol(parts[2]),
        ...summarizeAddress(parts[4]),
        ...(relatedAddressIndex < 0
            ? {}
            : relatedAddressSummary(parts[relatedAddressIndex + 1])),
    };
}
export function summarizeAddress(address) {
    if (address === undefined || address.length === 0)
        return { addressFamily: 'unknown', addressScope: 'unknown' };
    if (address.includes(':'))
        return { addressFamily: 'ipv6', addressScope: summarizeIpv6Scope(address) };
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return { addressFamily: 'unknown', addressScope: 'unknown' };
    }
    return { addressFamily: 'ipv4', addressScope: summarizeIpv4Scope(parts) };
}
export function stunOnlyIceServers(iceServers) {
    const direct = [];
    for (const server of iceServers) {
        const sourceUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const urls = sourceUrls.filter(isStunUrl);
        if (urls.length === 0)
            continue;
        direct.push({ urls: Array.isArray(server.urls) ? urls : urls[0] });
    }
    return direct;
}
function isStunUrl(url) {
    const value = url.trim().toLowerCase();
    return value.startsWith('stun:') || value.startsWith('stuns:');
}
function emptyCandidateSummary() {
    return { candidateType: 'unknown', addressFamily: 'unknown', addressScope: 'unknown' };
}
function parseCandidateType(value) {
    if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay')
        return value;
    return 'unknown';
}
function normalizeProtocol(value) {
    if (value === undefined || value.length === 0)
        return undefined;
    return value.toLowerCase();
}
function relatedAddressSummary(address) {
    const summary = summarizeAddress(address);
    return {
        relatedAddressFamily: summary.addressFamily,
        relatedAddressScope: summary.addressScope,
    };
}
function summarizeIpv4Scope(parts) {
    if (parts[0] === 0 || parts[0] >= 240)
        return 'reserved';
    if (parts[0] === 127)
        return 'loopback';
    if (parts[0] === 169 && parts[1] === 254)
        return 'link-local';
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        return 'cgnat';
    if (parts[0] >= 224)
        return 'reserved';
    if (parts[0] === 10)
        return 'private';
    if (parts[0] === 192 && parts[1] === 168)
        return 'private';
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        return 'private';
    return 'public';
}
function summarizeIpv6Scope(address) {
    const value = address.toLowerCase();
    if (value === '::1')
        return 'loopback';
    if (value.startsWith('fe80:'))
        return 'link-local';
    // Tailscale assigns overlay addresses from fd7a:115c:a1e0::/48. They are
    // ULA-shaped, but a selected pair using them is not evidence of a physical
    // LAN path. Reuse the non-LAN cgnat scope used for Tailscale's IPv4 range.
    if (value.startsWith('fd7a:115c:a1e0:'))
        return 'cgnat';
    if (value.startsWith('fc') || value.startsWith('fd'))
        return 'private';
    if (value.startsWith('ff'))
        return 'reserved';
    return 'public';
}
function adaptDataChannel(raw) {
    return {
        get label() { return raw.label; },
        get ordered() { return raw.ordered; },
        get readyState() { return raw.readyState; },
        get bufferedAmount() { return raw.bufferedAmount; },
        get binaryType() { return raw.binaryType; },
        set binaryType(value) { raw.binaryType = value; },
        set onopen(value) { raw.onopen = value; },
        get onopen() { return raw.onopen; },
        set onmessage(value) { raw.onmessage = value; },
        get onmessage() { return raw.onmessage; },
        set onclose(value) { raw.onclose = value; },
        get onclose() { return raw.onclose; },
        set onerror(value) { raw.onerror = value; },
        get onerror() { return raw.onerror; },
        set onbufferedamountlow(value) { raw.onbufferedamountlow = value; },
        get onbufferedamountlow() { return raw.onbufferedamountlow; },
        send(data) { raw.send(data); },
        close() { raw.close(); },
    };
}
