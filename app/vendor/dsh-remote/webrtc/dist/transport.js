export class BaseTransport {
    handlers = new Set();
    closeHandlers = new Set();
    onMessage(cb) {
        this.handlers.add(cb);
        return () => this.handlers.delete(cb);
    }
    onClose(cb) {
        this.closeHandlers.add(cb);
        return () => this.closeHandlers.delete(cb);
    }
    emit(data) {
        for (const handler of this.handlers)
            handler(data);
    }
    emitClose(error) {
        for (const handler of this.closeHandlers)
            handler(error);
    }
}
