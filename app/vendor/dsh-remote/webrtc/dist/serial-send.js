/** Serialize encryption with transmission, bounded even when the transport stalls. */
export class SerialSend {
    tail = Promise.resolve();
    bytes = 0;
    count = 0;
    async run(bytes, send) {
        if (this.bytes + bytes > 8 * 1024 * 1024 || this.count >= 256)
            throw new Error('Encrypted send queue exceeds its limit');
        this.bytes += bytes;
        this.count += 1;
        const task = this.tail.then(send);
        this.tail = task.catch(() => undefined);
        try {
            await task;
        }
        finally {
            this.bytes -= bytes;
            this.count -= 1;
        }
    }
}
