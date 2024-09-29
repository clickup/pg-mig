[@clickup/pg-mig](README.md) / Exports

# @clickup/pg-mig

## Interfaces

- [MigrateOptions](interfaces/MigrateOptions.md)

## Functions

### main

▸ **main**(): `Promise`\<`boolean`\>

CLI tool entry point. This function is run when `pg-mig` is called from the
command line. Accepts parameters from process.argv. See `migrate()` for
option names.

If no options are passed, uses `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE` environment variables which are standard for e.g. `psql`.

You can pass multiple hosts separated by comma or semicolon.

Examples:
```
pg-mig --make=my-migration-name@sh
pg-mig --make=other-migration-name@sh0000
pg-mig --undo 20191107201239.my-migration-name.sh
pg-mig
```

#### Returns

`Promise`\<`boolean`\>

#### Defined in

[src/cli.ts:72](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L72)

___

### migrate

▸ **migrate**(`options`): `Promise`\<`boolean`\>

Similar to main(), but accepts options explicitly, not from process.argv.
This function is meant to be called from other tools.

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`MigrateOptions`](interfaces/MigrateOptions.md) |

#### Returns

`Promise`\<`boolean`\>

#### Defined in

[src/cli.ts:117](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L117)
