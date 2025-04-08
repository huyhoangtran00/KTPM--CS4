const Data = require('../models/dataModel');

class Persistent {
  // static async write(key, value) {
  //   try {
  //     const [instance, created] = await Data.upsert({
  //       keyID: key,
  //       value: value
  //     });
      
  //     return created ? 'Created new record' : 'Updated existing record';
  //   } catch (err) {
  //     throw new Error(err.message);
  //   }
  // }

  static async write(key, value) {
    try {
      const record = await Data.findOne({
        where: { keyID: key }
      });
  
      await Data.upsert({
        keyID: key,
        value: value
      });
  
      if (record) {
        return 'Updated existing record';
      } else {
        return 'Created new record';
      }
  
    } catch (err) {
      throw new Error(err.message);
    }
  }
  
  static async view(key) {
    try {
      const record = await Data.findOne({
        where: { keyID: key }
      });
      
      return record ? record.value : null;
    } catch (err) {
      throw new Error(err.message);
    }
  }
}

module.exports = Persistent;



