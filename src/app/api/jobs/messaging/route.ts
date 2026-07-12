import {getServerEnvironment} from "@/lib/env";import {runMessagingJobs} from "@/domains/messaging/service";
async function run(request:Request){const secret=getServerEnvironment().CRON_SECRET;if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return Response.json({error:"Unauthorized"},{status:401});return Response.json(await runMessagingJobs());}
export const GET=run;export const POST=run;
