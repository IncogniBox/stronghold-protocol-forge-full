class Event {
  constructor(time, data) {
    if (data == null)
      throw new Error("data cannot be null.");
    this.time = time;
    this.data = data;
  }
}

export { Event };
//# sourceMappingURL=Event.mjs.map
