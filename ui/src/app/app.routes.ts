import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./repos/repo-list/repo-list.component').then(m => m.RepoListComponent) },
  { path: 'search', loadComponent: () => import('./search/search.component').then(m => m.SearchComponent) },
  { path: ':name/:ref/browse', loadComponent: () => import('./file-browser/file-browser.component').then(m => m.FileBrowserComponent) },
  { path: ':name/:ref/symbols', loadComponent: () => import('./symbol-explorer/symbol-explorer.component').then(m => m.SymbolExplorerComponent) },
  { path: ':name', loadComponent: () => import('./repos/repo-detail/repo-detail.component').then(m => m.RepoDetailComponent) },
];
