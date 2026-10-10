'use strict';

class Event {
  constructor(time, data) {
    if (data == null)
      throw new Error("data cannot be null.");
    this.time = time;
    this.data = data;
  }
}

exports.Event = Event;
//# sourceMappingURL=Event.js.map
