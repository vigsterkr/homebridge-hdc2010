/*eslint no-unused-vars: ["error", { "args": "none" }]*/
"use strict";

const hdc2010 = require("./hdc2010");
var os = require("os");
var hostname = os.hostname();

const fixed2 = (number) => (Math.round(number * 100) / 100).toFixed(2);

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    "@vigsterkr/homebridge-hdc2010",
    "HDC2010",
    HDC2010Plugin
  );
};

class HDC2010Plugin {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.refresh = config["refresh"] || 60; // Update every minute
    this.options = config.options || { refreshRate: "60sec" };

    this.init = false;
    this.data = {};
    if ("i2cBusNumber" in this.options)
      this.options.i2cBusNumber = parseInt(this.options.i2cBusNumber);
    if ("i2cAddress" in this.options)
      this.options.i2cAddress = parseInt(this.options.i2cAddress);
    this.log(`HDC2010 sensor options: ${JSON.stringify(this.options)}`);

    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Texas Instruments Inc.")
      .setCharacteristic(Characteristic.Model, "HDC2010")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + hostname)
      .setCharacteristic(
        Characteristic.FirmwareRevision,
        require("../package.json").version
      );

    hdc2010
      .open(this.options)
      .then((sensor) => {
        this.log(`HDC2010 initialization succeeded`);
        this.sensor = sensor;
        this.init = true;
      })
      .catch((err) => this.log(`HDC2010 initialization failed: ${err} `));

    this.temperatureService = new Service.TemperatureSensor(this.name);

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100,
      });

    this.humidityService = new Service.HumiditySensor(this.name);
    this.humidityService
      .getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .setProps({
        minValue: 0,
        maxValue: 100,
      });

    setInterval(this.devicePolling.bind(this), this.refresh * 1000);

    this.temperatureService.log = this.log;
  }

  devicePolling() {
    if (this.sensor) {
      var measure = Promise.resolve();
      if (
        this.options.refreshRate !== undefined &&
        this.options.refreshRate == "manual"
      ) {
        measure = this.sensor.measure();
      }

      measure.then((_) => {
        this.sensor.temperature().then((temp) => {
          this.log(`${fixed2(temp.celsius)}°C`);
          this.temperatureService.setCharacteristic(
            Characteristic.CurrentTemperature,
            temp.celsius
          );
        });

        if (this.options.mode !== undefined && this.options.mode == "temp") {
          return;
        }
        this.sensor
          .humidity()
          .then((humidity) => {
            this.log(`${fixed2(humidity.rh)}%`);
            this.humidityService.setCharacteristic(
              Characteristic.CurrentRelativeHumidity,
              humidity.rh
            );
          })
          .catch((err) => {
            this.log(`HDC2010 read error: ${err}`);
            console.log(err.stack);
          });
      });
    } else {
      this.log("Error: HDC2010 not initialized");
    }
  }

  getServices() {
    return [
      this.informationService,
      this.temperatureService,
      this.humidityService,
    ];
  }
}
