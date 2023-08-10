#!/usr/bin/env node

const SwitchKeymap = 0x11; // ref: https://github.com/UltimateHackingKeyboard/agent/blob/5e3c725f3a365b2e23ec0d58883cbedd5532cd52/packages/uhk-usb/src/constants.ts#L26
const UHK_VENDOR_ID = 0x1D50 // ref: https://github.com/UltimateHackingKeyboard/agent/blob/5e3c725f3a365b2e23ec0d58883cbedd5532cd52/packages/uhk-common/src/models/uhk-products.ts#L4
const UHK_60_DEVICE = {
  id: 1,
  name: 'UHK 60 v1',
  vendorId: UHK_VENDOR_ID,
  keyboardPid: 0x6122,
  bootloaderPid: 0x6120,
  buspalPid: 0x6121
}

const UHK_60_V2_DEVICE = {
  id: 2,
  name: 'UHK 60 v2',
  vendorId: UHK_VENDOR_ID,
  keyboardPid: 0x6124,
  bootloaderPid: 0x6123,
  buspalPid: 0x6121
}

const UHK_DEVICES = [
  UHK_60_DEVICE,
  UHK_60_V2_DEVICE
]

const { HID, devices }  = require('node-hid')
const { platform, release } = require('os')
const semver = require('semver')
const isOsProvideUsbInterface = platform() !== 'darwin' || semver.lt(release(), '22.4.0')
const snooze = ms => new Promise((resolve) => setTimeout(resolve, ms));

const isUhkZeroInterface = (dev) => { // ref: https://github.com/UltimateHackingKeyboard/agent/blob/5e3c725f3a365b2e23ec0d58883cbedd5532cd52/packages/uhk-usb/src/util.ts#L105
  return UHK_DEVICES.some(device => dev.vendorId === device.vendorId &&
      dev.productId === device.keyboardPid &&
      ((dev.usagePage === 128 && dev.usage === 129) || // Old firmware
          (dev.usagePage === (0xFF00 | 0x00) && dev.usage === 0x01) || // New firmware
          (dev.interface === 0 && isOsProvideUsbInterface)
      )
  )
}

const getUhkDevices = () => devices().filter(x => x.vendorId === UHK_VENDOR_ID)

const connectToDevice = () => {
  const devs = getUhkDevices()
  const dev = devs.find(isUhkZeroInterface)

  if (!dev) {
    return null
  }

  return new HID(dev.path)
}

function convertBufferToIntArray(buffer) {
  return Array.prototype.slice.call(buffer, 0);
}

function getTransferData(buffer) {
  const data = convertBufferToIntArray(buffer);
  data.unshift(0);

  return data;
}


const sendCommand = async (buffer) => {
  const device = connectToDevice()

  if (!device) {
    throw new Error('[UhkHidDevice] Device is not connected')
  }

  try {
    const sendData = getTransferData(buffer)

    device.write(sendData)

    await snooze(1)

    const receivedData = device.readTimeout(1000)

    if (receivedData[0] !== 0) {
      throw new Error(`Communications error with UHK. Response code: ${receivedData[0]}`)
    }

    return Buffer.from(receivedData)
  } finally {
    device.close()
  }
}

const switchKeymap = (keymapAbbreviation) => sendCommand(Buffer.concat([
  Buffer.from([SwitchKeymap, keymapAbbreviation.length]),
  Buffer.from(keymapAbbreviation, 'utf8')
]))

module.exports = { switchKeymap }

if (require.main === module) { // if run directly
  const [ , , keymapAbbreviation ] = process.argv // if run with argument, switch keymap and exit

  const skm = (keymapAbbreviation) => switchKeymap(keymapAbbreviation).then(() => {
      console.log('[%s] Switch To [%s] Success', new Date().toJSON(), keymapAbbreviation)
    }, (e) => {
      console.error(new Date().toJSON(), e)
    })

  if (keymapAbbreviation) {
    skm(keymapAbbreviation)
    process.exit(0)
  }

  console.log('[%s] Start', new Date().toJSON())

  const { WebUSB } = require('usb') // if run without argument, listen for usb connect event

  const usb = new WebUSB({
    allowAllDevices: true
  })

  const KeyMaps = {
    darwin: 'QWM',
    win32: 'QWR',
    linux: 'QWR',
    'default': 'QWR',
  }

  usb.addEventListener('connect', (event) => {
    if (/^UHK 60 v\d/.test(event.device.productName)) {
      skm(KeyMaps[platform()] || KeyMaps['default'])
    }
  })
}
