import {notFound} from 'next/navigation';
import Home from '../workspace';
import {routeViews} from '../view-routes';

export default async function WorkspaceRoute({params}:{params:Promise<{view:string}>}){
 const {view}=await params;
 const initialView=routeViews[view as keyof typeof routeViews];
 if(!initialView)notFound();
 return <Home initialView={initialView}/>;
}
