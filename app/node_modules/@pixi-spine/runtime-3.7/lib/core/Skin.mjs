class Skin {
  constructor(name) {
    this.attachments = new Array();
    if (name == null)
      throw new Error("name cannot be null.");
    this.name = name;
  }
  addAttachment(slotIndex, name, attachment) {
    if (attachment == null)
      throw new Error("attachment cannot be null.");
    const attachments = this.attachments;
    if (slotIndex >= attachments.length)
      attachments.length = slotIndex + 1;
    if (!attachments[slotIndex])
      attachments[slotIndex] = {};
    attachments[slotIndex][name] = attachment;
  }
  /** @return May be null. */
  getAttachment(slotIndex, name) {
    const dictionary = this.attachments[slotIndex];
    return dictionary ? dictionary[name] : null;
  }
  /** Attach each attachment in this skin if the corresponding attachment in the old skin is currently attached. */
  attachAll(skeleton, oldSkin) {
    let slotIndex = 0;
    for (let i = 0; i < skeleton.slots.length; i++) {
      const slot = skeleton.slots[i];
      const slotAttachment = slot.getAttachment();
      if (slotAttachment && slotIndex < oldSkin.attachments.length) {
        const dictionary = oldSkin.attachments[slotIndex];
        for (const key in dictionary) {
          const skinAttachment = dictionary[key];
          if (slotAttachment == skinAttachment) {
            const attachment = this.getAttachment(slotIndex, key);
            if (attachment != null)
              slot.setAttachment(attachment);
            break;
          }
        }
      }
      slotIndex++;
    }
  }
}

export { Skin };
//# sourceMappingURL=Skin.mjs.map
