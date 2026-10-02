import {Ledger,embeddedDatabase} from '@mandate/store';
const ledger=new Ledger(embeddedDatabase(process.argv[2]));
const reservation=await ledger.reserve({accountId:'account',planRevisionId:'plan',idempotencyKey:'crash-request',amountAtomic:'2000000000000000000000'});
await ledger.beginSubmission(reservation.id,'crash-submission');
process.send?.({reservationId:reservation.id});
// The parent terminates the process without closing the database.
setInterval(()=>{},1000);
