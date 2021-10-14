# homebridge-hdc2010
Homebridge plugin for the TI HDC2010 sensor on RasPi.


## Installation

`npm install homebridge-hdc2010`


## Configuration

Enabled by adding an entry ino the 'accessories' section of the `config.json` file.  The named sections have the following behaviors:

* `accessory` - must be "HDC2010" to identify the plugin
* `name` - initial name in Homekit of the sensor.  May be changed here, or in the Home app.
* `refresh` - specifies the refresh time in seconds.  The sensor is polled using this interval, and Homekit is provided with the last
value read. If omitted, the default value of 60 seconds is used.

## Example Configuration

config.json
```json
    {
         "bridge": {
         "name": "Homebridge",
         "username": "CC:46:3D:E3:CE:30",
         "port": 51826,
         "pin": "031-45-154"
     },
     "description": "Config file for raspberry pi running HDC2010 temperature sensor",

     "accessories": [
        {
            "accessory": "HDC2010",
            "name": "HDC2010",
            "refresh": 60,
            "options": {
                "i2cBusNumber": 1,
                "i2cAddress": "0x40",
                "tempResolution": 14,
                "humidResolution": 14,
                "mode": "temp_humid",
                "refreshRate": "60sec"
            }
        }
     ],

     "platforms": [
     ]
    }
```
