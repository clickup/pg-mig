[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / migrate

# Function: migrate()

> **migrate**(`options`): `Promise`\<`boolean`\>

Defined in: [src/cli.ts:163](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L163)

Similar to main(), but accepts options explicitly, not from process.argv.
This function is meant to be called from other tools.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`MigrateOptions`](../interfaces/MigrateOptions.md) |

## Returns

`Promise`\<`boolean`\>
