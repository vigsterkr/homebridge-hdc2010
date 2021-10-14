/*eslint no-unused-vars: ["error", { "args": "none" }]*/
"use strict";

const EventEmitter = require("events");
const i2c = require("i2c-bus");
const mutexify = require("mutexify");

const DEFAULT_I2C_BUS = 1;
const DEFAULT_I2C_ADDRESS = 0x40;

const MANUFACTURER_ID = 0x5449;
const DEVICE_ID = 0x07d0;

// registers
const HDC2010_TEMP = 0x00;
const HDC2010_HUMID = 0x02;
const HDC2010_CONFIG = 0x0e;
const HDC2010_MEASUREMENT_CONFIG = 0x0f;
const HDC2010_MID = 0xfc;
const HDC2010_DEVICE_ID = 0xfe;

// resolution
const HDC2010_FOURTEEN_BIT = 14;
const HDC2010_ELEVEN_BIT = 11;
const HDC2010_NINE_BIT = 9;

// Constants for setting sensor mode
const HDC2010_TEMP_AND_HUMID = "temp_humid";
const HDC2010_TEMP_ONLY = "temp";

// Constants for setting sample rate
const HDC2010_MANUAL = "manual";
const HDC2010_TWO_MINS = "120sec";
const HDC2010_ONE_MINS = "60sec";
const HDC2010_TEN_SECONDS = "10sec";
const HDC2010_FIVE_SECONDS = "5sec";
const HDC2010_ONE_HZ = "1hz";
const HDC2010_TWO_HZ = "2hz";
const HDC2010_FIVE_HZ = "5hz";

const configRegLock = mutexify();

const validateOpenOptions = (options) => {
  if (typeof options !== "object") {
    return (
      "Expected options to be of type object." +
      " Got type " +
      typeof options +
      "."
    );
  }

  if (
    options.i2cBusNumber !== undefined &&
    (!Number.isSafeInteger(options.i2cBusNumber) || options.i2cBusNumber < 0)
  ) {
    return (
      "Expected i2cBusNumber to be a non-negative integer." +
      ' Got "' +
      options.i2cBusNumber +
      '".'
    );
  }

  if (
    options.i2cAddress !== undefined &&
    options.i2cAddress != 0x40 &&
    options.i2cAddress != 0x41
  ) {
    return (
      "Expected i2cAddress to be an integer" +
      ' 0x40 or 0x41. Got "' +
      options.i2cAddress +
      '".'
    );
  }

  const validRefreshRates = new Array(
    HDC2010_MANUAL,
    HDC2010_TWO_MINS,
    HDC2010_ONE_MINS,
    HDC2010_ONE_MINS,
    HDC2010_FIVE_SECONDS,
    HDC2010_ONE_HZ,
    HDC2010_ONE_HZ,
    HDC2010_FIVE_HZ
  );
  if (
    options.refreshRate !== undefined &&
    !validRefreshRates.includes(options.refreshRate)
  ) {
    return (
      "Expected refreshRate to be one of the following strings: " +
      validRefreshRates +
      '".'
    );
  }

  const validResolutions = new Array(
    HDC2010_FOURTEEN_BIT,
    HDC2010_ELEVEN_BIT,
    HDC2010_NINE_BIT
  );
  if (
    options.tempResolution !== undefined &&
    !validResolutions.includes(options.tempResolution)
  ) {
    return (
      "Expected tempResolution to be one of the following integers: " +
      validResolutions +
      '".'
    );
  }

  if (
    options.humidResolution !== undefined &&
    !validResolutions.includes(options.humidResolution)
  ) {
    return (
      "Expected humidResolution to be one of the following integers: " +
      validResolutions +
      '".'
    );
  }

  if (
    options.mode !== undefined &&
    (options.mode != "temp" && options.mode != "temp_humid")
  ) {
    return "Expected mode to be one of the following strings: 'temp' or 'temp_humid'";
  }

  return null;
};

class I2cHDC2010 {
  constructor(i2cBus, i2cAddress) {
    this._i2cBus = i2cBus;
    this._i2cAddress = i2cAddress;
  }

  close() {
    return this._i2cBus.close();
  }

  readByte(register) {
    return this._i2cBus.readByte(this._i2cAddress, register);
  }

  writeByte(register, byte) {
    return this._i2cBus.writeByte(this._i2cAddress, register, byte);
  }

  readWord(register) {
    return this._i2cBus.readWord(this._i2cAddress, register);
  }

  writeWord(register, word) {
    return this._i2cBus.writeWord(
      this._i2cAddress,
      register,
      (word >> 8) + ((word & 0xff) << 8)
    );
  }

  softReset() {
    return this.configuration(HDC2010_CONFIG, 0x80, 0x0);
  }

  heaterOn() {
    return this.configuration(HDC2010_CONFIG, 0x08, 0x0);
  }

  heaterOff() {
    return this.configuration(HDC2010_CONFIG, 0x0, 0x08);
  }

  configuration(register, bitsToSet, bitsToReset) {
    let releaseConfigRegLock = null;

    // To modify bits in the configuration register it's necessary to read
    // the register, modify the required bits and write back to the
    // register. In order to prevent parallel asynchronous operations that
    // are modifying the configuration register from stepping on each other
    // here a mutex is needed.
    return new Promise((resolve, reject) => {
      configRegLock((release) => {
        releaseConfigRegLock = release;
        resolve();
      });
    })
      .then((_) => this.readByte(register))
      .then((config) => {
        config &= ~bitsToReset & 0xff;
        config |= bitsToSet;

        return this.writeByte(register, config);
      })
      .then((_) => releaseConfigRegLock())
      .catch((err) => {
        if (releaseConfigRegLock !== null) {
          releaseConfigRegLock();
        }
        return Promise.reject(err);
      });
  }

  measure() {
    return this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x01, 0x0);
  }

  temperature() {
    return this.readWord(HDC2010_TEMP).then((rawTemp) => {
      let temp = (rawTemp * 165.0) / 65536.0 - 40;

      return {
        celsius: temp,
        rawTemp: rawTemp,
      };
    });
  }

  humidity() {
    return this.readWord(HDC2010_HUMID).then((rawHumidity) => {
      let humidity = (rawHumidity / 65536.0) * 100.0;

      return {
        rh: humidity,
        rawHumid: rawHumidity,
      };
    });
  }

  manufacturerId() {
    return this.readWord(HDC2010_MID);
  }

  deviceId() {
    return this.readWord(HDC2010_DEVICE_ID);
  }

  temperatureResolution(resolution) {
    switch (resolution) {
      case HDC2010_NINE_BIT:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x80, 0x40);
        break;
      case HDC2010_ELEVEN_BIT:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x40, 0x80);
        break;
      case HDC2010_FOURTEEN_BIT:
      default:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x0, 0xc0);
    }
  }

  humidityResolution(resolution) {
    switch (resolution) {
      case HDC2010_NINE_BIT:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x20, 0x10);
        break;
      case HDC2010_ELEVEN_BIT:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x10, 0x20);
        break;
      case HDC2010_FOURTEEN_BIT:
      default:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x0, 0x30);
    }
  }

  refreshRate(rate) {
    switch (rate) {
      case HDC2010_TWO_MINS:
        this.configuration(HDC2010_CONFIG, 0x10, 0x60);
        break;
      case HDC2010_ONE_MINS:
        this.configuration(HDC2010_CONFIG, 0x20, 0x50);
        break;
      case HDC2010_TEN_SECONDS:
        this.configuration(HDC2010_CONFIG, 0x30, 0x40);
        break;
      case HDC2010_FIVE_SECONDS:
        this.configuration(HDC2010_CONFIG, 0x40, 0x30);
        break;
      case HDC2010_ONE_HZ:
        this.configuration(HDC2010_CONFIG, 0x50, 0x20);
        break;
      case HDC2010_TWO_HZ:
        this.configuration(HDC2010_CONFIG, 0x60, 0x10);
        break;
      case HDC2010_FIVE_HZ:
        this.configuration(HDC2010_CONFIG, 0x70, 0x0);
        break;
      case HDC2010_MANUAL:
      default:
        this.configuration(HDC2010_CONFIG, 0x0, 0x70);
    }
  }

  mode(mode) {
    switch (mode) {
      case HDC2010_TEMP_ONLY:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x02, 0x4);
        break;
      case HDC2010_TEMP_AND_HUMID:
      default:
        this.configuration(HDC2010_MEASUREMENT_CONFIG, 0x0, 0x6);
    }
  }
}

class HDC2010 extends EventEmitter {
  constructor(i2cHDC2010) {
    super();

    this._i2cHDC2010 = i2cHDC2010;
  }

  static open(options) {
    let i2cHDC2010;
    let sensor;

    return Promise.resolve()
      .then((_) => {
        options = options || {};

        let errMsg = validateOpenOptions(options);
        if (errMsg) {
          return Promise.reject(new Error(errMsg));
        }

        return i2c.openPromisified(
          options.i2cBusNumber === undefined
            ? DEFAULT_I2C_BUS
            : options.i2cBusNumber
        );
      })
      .then((i2cBus) => {
        const i2cAddress =
          options.i2cAddress === undefined
            ? DEFAULT_I2C_ADDRESS
            : options.i2cAddress;
        i2cHDC2010 = new I2cHDC2010(i2cBus, i2cAddress);

        sensor = new HDC2010(i2cHDC2010);
      })
      .then((_) => i2cHDC2010.manufacturerId())
      .then((manufacturerId) => {
        if (manufacturerId !== MANUFACTURER_ID) {
          return Promise.reject(
            new Error(
              "Expected manufacturer ID to be 0x" +
                MANUFACTURER_ID.toString(16) +
                ". Got 0x" +
                manufacturerId.toString(16) +
                ". HDC2010 sensor not found."
            )
          );
        }
        return i2cHDC2010.deviceId();
      })
      .then((deviceId) => {
        if (deviceId !== DEVICE_ID) {
          return Promise.reject(
            new Error(
              "Expected device ID to be 0x" +
                DEVICE_ID.toString(16) +
                ". Got 0x" +
                deviceId.toString(16) +
                ". HDC2010 sensor not found."
            )
          );
        }
        return i2cHDC2010.softReset();
      })
      .then((_) => {
        if (options.mode !== undefined) {
          return i2cHDC2010.mode(options.mode);
        }
      })
      .then((_) => {
        if (options.tempResolution !== undefined) {
          return i2cHDC2010.temperatureResolution(options.tempResolution);
        }
      })
      .then((_) => {
        if (options.humidResolution !== undefined) {
          return i2cHDC2010.humidityResolution(options.humidResolution);
        }
      })
      .then((_) => {
        if (options.refreshRate !== undefined) {
          const r = i2cHDC2010.refreshRate(options.refreshRate);
          if (options.refreshRate !== HDC2010_MANUAL) {
            return i2cHDC2010.measure();
          }
          return r;
        }
      })
      .then((_) => sensor);
  }

  close() {
    return Promise.resolve().then((_) => {
      return this._i2cHDC2010.close();
    });
  }

  temperature() {
    return this._i2cHDC2010.temperature();
  }

  humidity() {
    return this._i2cHDC2010.humidity();
  }
}

module.exports = HDC2010;
