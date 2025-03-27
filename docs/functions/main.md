[**@clickup/pg-mig**](../README.md)

***

[@clickup/pg-mig](../globals.md) / main

# Function: main()

> **main**(`argsIn`): `Promise`\<`boolean`\>

Defined in: [src/cli.ts:87](https://github.com/clickup/pg-mig/blob/master/src/cli.ts#L87)

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
pg-mig --undo=20191107201239.my-migration-name.sh
pg-mig --list
pg-mig --list=digest
pg-mig
```

## Parameters

| Parameter | Type |
| ------ | ------ |
| `argsIn` | `string`[] |

## Returns

`Promise`\<`boolean`\>
