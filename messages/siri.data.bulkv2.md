# summary

Perform bulk data operations using Salesforce Bulk API v2.

# description

Execute high-performance bulk data operations including insert, update, upsert, delete, and query operations on large datasets with progress tracking and comprehensive error handling.

# examples

- Insert records into Account object:

  <%= config.bin %> <%= command.id %> insert --sobjecttype Account --csvfile accounts.csv

- Check the status of a bulk job:

  <%= config.bin %> <%= command.id %> status --jobid 750xx0000000044AAA

# info.jobDetails
Check job %s status with the command
sfdx siri:data:bulkv2:status -i %s


# info.jobStatus
Job Status

# info.jobStatusInfo

Job %s is still in %s state.

# status.summary

Track the status of a Bulk API v2 job.

# status.description

Retrieve real-time progress and status information for a bulk job execution.

# status.examples

sf  siri data bulkv2 status -i 7505r0000xxxxxxxxx(jobid)

# insert.summary

Insert records into the org using Bulk API v2.

# insert.description

Load thousands of records efficiently into Salesforce using the Bulk API v2 with automatic chunking for large CSV files.

# insert.examples

sf siri data bulkv2 insert -s Account -f '/csv/file/path/csvfile.csv'


# update.summary

Update records in the org using Bulk API v2.

# update.description

Updates existing records in bulk using the Salesforce Bulk API v2 with progress tracking.

# update.examples

sf siri data bulkv2 update -s Account -f '/csv/file/path/csvfile.csv'


# upsert.summary

Insert or update records using Bulk API v2 with external ID.

# upsert.description

Insert or update records in bulk using the Salesforce Bulk API v2 with external ID lookups for matching.

# upsert.examples

sf siri data bulkv2 upsert -s Account -i externalId__c -f '/csv/file/path/csvfile.csv'

# query.summary

Execute SOQL queries at scale using Bulk API v2.

# query.description

Execute SOQL queries against large datasets with streaming results to CSV using the Salesforce Bulk API v2.

# query.examples

sf siri data bulkv2 query -s Account -q \"SELECT Id FROM ACCOUNT\" -f '/csv/file/path/csvfile.csv'

# results.summary

Download results from a completed Bulk API v2 job.

# results.description

Fetch and export success, failed, or unprocessed records from a completed bulk job.

# results.examples

sf siri data bulkv2 results -i 7505r0000xxxxxxxxx -t success -f /csv/output/file/path/csvfile.csv

# results.failure

Technical error occurred while fetching the results. \n %s
    

# delete.summary

Delete or hard delete records using Bulk API v2.

# delete.description

Remove records at scale using the Salesforce Bulk API v2 with support for soft delete (Recycle Bin) or hard delete.

# delete.examples

sf siri data bulkv2 delete -s Account -f /csv/file/path/csvfile.csv
sf siri data bulkv2 delete -s Account --hard -f /csv/file/path/csvfile.csv

# flags.targetorg.summary

The target org for the command

# flags.csvfile.summary

Path to the CSV file containing the records to process.

# flags.csvfile.description

The CSV file must have a header row whose column names match the API names of the fields on the sObject. For delete operations only an Id column is required. Files larger than the Bulk API v2 limit are split into multiple jobs automatically.

# flags.sobjecttype.summary

API name of the sObject to operate on.

# flags.sobjecttype.description

The API name of the standard or custom object that the records belong to, for example Account or Invoice__c.

# flags.columndelimiter.summary

Column delimiter used in the CSV job data.

# flags.columndelimiter.description

Valid values are BACKQUOTE (`), CARET (^), COMMA (,), PIPE (|), SEMICOLON (;) and TAB. The default is COMMA.

# flags.lineending.summary

Line ending used in the CSV job data.

# flags.lineending.description

Valid values are LF (linefeed) and CRLF (carriage return followed by linefeed). The default is LF.

# flags.externalid.summary

Name of the external ID field used to match records.

# flags.externalid.description

The API name of an external ID field on the sObject. Records whose external ID value matches an existing record are updated, all others are inserted.

# flags.hard.summary

Permanently delete records instead of moving them to the Recycle Bin.

# flags.hard.description

Hard-deleted records cannot be restored. The running user needs the "Bulk API Hard Delete" permission, otherwise the job fails.

# flags.query.summary

SOQL query to execute.

# flags.query.description

The SOQL query whose results are streamed to the output CSV file. Wrap the query in quotes so the shell passes it as a single argument.

# flags.outputfile.summary

Path to the CSV file where results are written.

# flags.outputfile.description

The file is created if it does not exist and overwritten if it does. Parent directories must already exist.

# flags.jobid.summary

ID of the Bulk API v2 job.

# flags.jobid.description

The 18-character job ID returned when the job was created, for example 7505r0000xxxxxxxxx.

# flags.type.summary

Type of results to download.

# flags.type.description

Valid values are SUCCESS, FAILED, UNPROCESSED, QUERY_RESULT and QUERY_STATUS. Use SUCCESS, FAILED or UNPROCESSED for ingest jobs and QUERY_RESULT or QUERY_STATUS for query jobs. The default is SUCCESS.

# flags.statustype.summary

Kind of job whose status to check.

# flags.statustype.description

Valid values are STATUS for ingest jobs (insert, update, upsert, delete) and QUERY for query jobs. The default is STATUS.
