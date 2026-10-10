'use strict';

class Event {
  constructor(time, data) {
    this.intValue = 0;
    this.floatValue = 0;
    this.stringValue = null;
    this.time = 0;
    this.volume = 0;
    this.balance = 0;
    if (!data)
      throw new Error("data cannot be null.");
    this.time = time;
    this.data = data;
  }
}

exports.Event = Event;
//# sourceMappingURL=Event.js.map
