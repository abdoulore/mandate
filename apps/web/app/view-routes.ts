export const primaryNavigation=[
 {label:'Regime',text:'Cost history',href:'/regime'},
 {label:'Execution review',text:'Token research',href:'/execution-review'},
 {label:'Portfolio/exit',text:'Plan and exit',href:'/portfolio-exit'},
] as const;

export const routeViews={
 regime:'Regime',
 'execution-review':'Execution review',
 'portfolio-exit':'Portfolio/exit',
 overview:'Overview',
 portfolio:'Portfolio',
 plans:'Plans',
 instruments:'Instruments',
 withdraw:'Withdraw',
 lab:'Lab',
 'cash-raising':'Cash raising',
 inflows:'Inflows',
 recurring:'Recurring',
 'cash-rules':'Cash rules',
 rebalance:'Rebalance',
 records:'Records',
 passports:'Passports',
 'saved-evidence-lab':'Lab',
} as const;

export type WorkspaceView=typeof routeViews[keyof typeof routeViews];
export function viewName(view:WorkspaceView){
 if(view==='Regime')return 'Cost history';
 if(view==='Execution review')return 'Token research';
 if(view==='Portfolio/exit')return 'Plan and exit';
 return view;
}
export function primaryViewFor(view:WorkspaceView){
 if(view==='Regime')return 'Regime';
 if(view==='Execution review'||view==='Instruments'||view==='Passports')return 'Execution review';
 if(view==='Lab')return null;
 return 'Portfolio/exit';
}
