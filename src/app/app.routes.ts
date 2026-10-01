import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { empleadoGuard } from './core/guards/empleado.guard';
import { invitadoGuard } from './core/guards/invitado.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/layout-publico.component').then(m => m.LayoutPublicoComponent),
    children: [
      { path: '', title: 'CineNova', loadComponent: () => import('./features/home/home.component').then(m => m.HomeComponent) },
      { path: 'peliculas', title: 'Cartelera · CineNova', loadComponent: () => import('./features/peliculas/cartelera.component').then(m => m.CarteleraComponent) },
      { path: 'peliculas/:id', loadComponent: () => import('./features/peliculas/detalle-pelicula.component').then(m => m.DetallePeliculaComponent) },
      { path: 'proximamente', title: 'Próximamente · CineNova', loadComponent: () => import('./features/peliculas/proximamente.component').then(m => m.ProximamenteComponent) },
      { path: 'candy', title: 'Candy bar · CineNova', loadComponent: () => import('./features/compra/candy.component').then(m => m.CandyComponent) },
      { path: 'comprar/:funcionId', title: 'Comprar entradas · CineNova', loadComponent: () => import('./features/compra/comprar.component').then(m => m.ComprarComponent) },
      { path: 'compra/:codigo', title: 'Tu entrada · CineNova', loadComponent: () => import('./features/compra/comprobante.component').then(m => m.ComprobanteComponent) },
      { path: 'cuenta', title: 'Mi cuenta · CineNova', canActivate: [authGuard], loadComponent: () => import('./features/cuenta/perfil.component').then(m => m.PerfilComponent) },
      { path: 'cuenta/compras', title: 'Mis compras · CineNova', canActivate: [authGuard], loadComponent: () => import('./features/cuenta/mis-compras.component').then(m => m.MisComprasComponent) },
      { path: 'cuenta/peliculas', title: 'Mis películas · CineNova', canActivate: [authGuard], loadComponent: () => import('./features/cuenta/mis-peliculas.component').then(m => m.MisPeliculasComponent) },
      { path: 'cuenta/puntos', title: 'Mis puntos · CineNova', canActivate: [authGuard], loadComponent: () => import('./features/cuenta/puntos.component').then(m => m.PuntosComponent) },
    ],
  },
  {
    path: 'auth',
    canActivate: [invitadoGuard],
    loadComponent: () => import('./layout/layout-auth.component').then(m => m.LayoutAuthComponent),
    children: [
      { path: 'login', title: 'Ingresar · CineNova', loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent) },
      { path: 'registro', title: 'Crear cuenta · CineNova', loadComponent: () => import('./features/auth/registro.component').then(m => m.RegistroComponent) },
      { path: '', redirectTo: 'login', pathMatch: 'full' },
    ],
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    loadComponent: () => import('./layout/layout-admin.component').then(m => m.LayoutAdminComponent),
    children: [
      { path: '', title: 'Panel · CineNova', loadComponent: () => import('./features/admin/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'peliculas', title: 'Películas · Admin', loadComponent: () => import('./features/admin/admin-peliculas.component').then(m => m.AdminPeliculasComponent) },
      { path: 'funciones', title: 'Funciones · Admin', loadComponent: () => import('./features/admin/admin-funciones.component').then(m => m.AdminFuncionesComponent) },
      { path: 'salas', title: 'Salas · Admin', loadComponent: () => import('./features/admin/admin-salas.component').then(m => m.AdminSalasComponent) },
      { path: 'candy', title: 'Candy bar · Admin', loadComponent: () => import('./features/admin/admin-candy.component').then(m => m.AdminCandyComponent) },
      { path: 'promociones', title: 'Promociones · Admin', loadComponent: () => import('./features/admin/admin-promociones.component').then(m => m.AdminPromocionesComponent) },
      { path: 'usuarios', title: 'Usuarios · Admin', loadComponent: () => import('./features/admin/admin-usuarios.component').then(m => m.AdminUsuariosComponent) },
      { path: 'reportes', title: 'Reportes · Admin', loadComponent: () => import('./features/admin/admin-reportes.component').then(m => m.AdminReportesComponent) },
      { path: 'log', title: 'Actividad · Admin', loadComponent: () => import('./features/admin/admin-log.component').then(m => m.AdminLogComponent) },
    ],
  },
  {
    path: 'empleado',
    title: 'Validación · CineNova',
    canActivate: [empleadoGuard],
    loadComponent: () => import('./features/empleado/validador.component').then(m => m.ValidadorComponent),
  },
  {
    path: '**',
    loadComponent: () => import('./features/home/no-encontrado.component').then(m => m.NoEncontradoComponent),
  },
];
