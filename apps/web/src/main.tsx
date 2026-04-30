import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  AppWindow,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Cloud,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  History,
  KeyRound,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  LogOut,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { api, formatApiError } from './api';
import dendrixLogo from './assets/dendrix-logo.png';
import type {
  AppSecret,
  AppStatus,
  AppSummary,
  ApiToken,
  AuditLog,
  Deployment,
  LifecycleEvent,
  LogLine,
  PlatformSettings,
  SystemUpdate,
  Team,
  User
} from './types';
import './styles.css';

type View = 'apps' | 'users' | 'teams' | 'settings' | 'tokens' | 'onboarding' | 'audit';

type DetailState = {
  deployments: Deployment[];
  secrets: AppSecret[];
  events: LifecycleEvent[];
  logs: LogLine[];
};

const emptyDetail: DetailState = {
  deployments: [],
  secrets: [],
  events: [],
  logs: []
};

function nameOf(user: User): string {
  return user.displayName ?? user.display_name ?? user.email;
}

function isAdmin(user: User | null): boolean {
  return Boolean(user?.isPlatformAdmin ?? user?.is_platform_admin);
}

function teamIdOf(app: AppSummary): string | undefined {
  return app.teamId ?? app.team_id ?? app.team?.id;
}

function teamName(teams: Team[], app: AppSummary): string {
  const teamId = teamIdOf(app);
  return app.team?.name ?? teams.find((team) => team.id === teamId)?.name ?? 'Unassigned';
}

function appUrl(app: AppSummary): string {
  const host = app.hostname ?? app.url ?? '';
  if (!host) {
    return 'Pending successful deployment';
  }

  return host.startsWith('http') ? host : `https://${host}`;
}

function updatedAt(app: AppSummary): string | undefined {
  return app.updatedAt ?? app.updated_at ?? app.createdAt ?? app.created_at;
}

function deploymentVersion(deployment: Deployment): number | undefined {
  return deployment.versionNumber ?? deployment.version_number;
}

function deploymentError(deployment: Deployment): string | undefined | null {
  return deployment.errorMessage ?? deployment.error_message ?? deployment.errorCode ?? deployment.error_code;
}

function deploymentStartedAt(deployment: Deployment): string | undefined | null {
  return deployment.startedAt ?? deployment.started_at ?? deployment.createdAt ?? deployment.created_at;
}

function formatDate(value?: string | null): string {
  if (!value) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function shortRevision(revision?: string): string {
  return revision ? revision.slice(0, 7) : '-';
}

function versionLabel(version?: string, tag?: string, revision?: string): string {
  if (version && version !== 'unknown') return version;
  return tag ?? shortRevision(revision);
}

function statusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: AppStatus | Deployment['status'] | string): string {
  if (['running', 'succeeded'].includes(status)) return 'good';
  if (['failed', 'cancelled'].includes(status)) return 'bad';
  if (['stopped'].includes(status)) return 'neutral';
  return 'busy';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readSetting<T>(settings: PlatformSettings, camel: keyof PlatformSettings, snake: keyof PlatformSettings, fallback: T): T {
  const value = settings[camel] ?? settings[snake];
  return (value ?? fallback) as T;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof AppWindow; title: string; body: string }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div className="banner error">
      <AlertTriangle size={18} />
      <span>{message}</span>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<PlatformSettings>({});
  const [systemUpdate, setSystemUpdate] = useState<SystemUpdate>();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [detail, setDetail] = useState<DetailState>(emptyDetail);
  const [view, setView] = useState<View>('apps');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [detailError, setDetailError] = useState<string>();

  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? apps[0] ?? null;

  const filteredApps = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return apps;

    return apps.filter((app) =>
      [app.name, app.slug, app.hostname, teamName(teams, app)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [apps, search, teams]);

  useEffect(() => {
    async function loadMe() {
      try {
        const response = await api.me();
        setUser(response.user);
        setTeams(response.teams ?? response.memberships ?? []);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    }

    void loadMe();
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshWorkspace();
  }, [user]);

  useEffect(() => {
    if (!selectedApp) return;
    void refreshDetail(selectedApp.id);
  }, [selectedApp?.id]);

  useEffect(() => {
    if (!user || !isAdmin(user) || systemUpdate?.state !== 'running') return;

    let cancelled = false;
    async function pollUpdate() {
      try {
        const nextUpdate = await api.getSystemUpdate();
        if (!cancelled) {
          setSystemUpdate(nextUpdate);
        }
      } catch {
        // The API can briefly disappear while Docker replaces the service.
      }
    }

    const firstPoll = window.setTimeout(() => void pollUpdate(), 1000);
    const interval = window.setInterval(() => void pollUpdate(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(firstPoll);
      window.clearInterval(interval);
    };
  }, [user, systemUpdate?.state, systemUpdate?.startedAt]);

  async function refreshWorkspace() {
    setLoading(true);
    setError(undefined);

    try {
      const [nextApps, nextTeams] = await Promise.all([api.listApps(), api.listTeams()]);
      const currentSelectedAppId = selectedAppId;
      const nextSelectedAppId = nextApps.some((app) => app.id === currentSelectedAppId)
        ? currentSelectedAppId
        : nextApps[0]?.id ?? null;
      setApps(nextApps);
      setTeams(nextTeams);
      setSelectedAppId(nextSelectedAppId);

      if (isAdmin(user)) {
        const [nextUsers, nextSettings, nextTokens, nextAuditLogs, nextSystemUpdate] = await Promise.all([
          api.listUsers(),
          api.getSettings(),
          api.listTokens(),
          api.listAuditLogs(),
          api.getSystemUpdate(true)
        ]);
        setUsers(nextUsers);
        setSettings(nextSettings);
        setTokens(nextTokens);
        setAuditLogs(nextAuditLogs);
        setSystemUpdate(nextSystemUpdate);
      }

      if (nextSelectedAppId && nextSelectedAppId === currentSelectedAppId) {
        await refreshDetail(nextSelectedAppId);
      }
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function refreshDetail(appId: string) {
    setDetailLoading(true);
    setDetailError(undefined);

    try {
      const [deployments, secrets, events, logs] = await Promise.all([
        api.listDeployments(appId),
        api.listSecrets(appId),
        api.listEvents(appId),
        api.listLogs(appId)
      ]);
      setDetail({ deployments, secrets, events, logs });
    } catch (caught) {
      setDetailError(formatApiError(caught));
    } finally {
      setDetailLoading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="boot">
        <Loader2 className="spin" size={30} />
        <span>Loading VibeStack</span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={(nextUser, nextTeams) => { setUser(nextUser); setTeams(nextTeams); }} />;
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={dendrixLogo} alt="Dendrix AI logo" />
          <div>
            <strong>VibeStack</strong>
            <span>by Dendrix AI</span>
          </div>
        </div>

        <nav className="nav">
          <button className={view === 'apps' ? 'active' : ''} onClick={() => setView('apps')}>
            <AppWindow size={18} /> Apps
          </button>
          <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')} disabled={!isAdmin(user)}>
            <Users size={18} /> Users
          </button>
          <button className={view === 'teams' ? 'active' : ''} onClick={() => setView('teams')} disabled={!isAdmin(user)}>
            <ShieldCheck size={18} /> Teams
          </button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')} disabled={!isAdmin(user)}>
            <Settings size={18} /> Settings
          </button>
          <button className={view === 'tokens' ? 'active' : ''} onClick={() => setView('tokens')} disabled={!isAdmin(user)}>
            <KeyRound size={18} /> API tokens
          </button>
          <button className={view === 'onboarding' ? 'active' : ''} onClick={() => setView('onboarding')} disabled={!isAdmin(user)}>
            <ClipboardList size={18} /> Onboarding
          </button>
          <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')} disabled={!isAdmin(user)}>
            <BookOpen size={18} /> Audit logs
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">{nameOf(user).slice(0, 1).toUpperCase()}</div>
          <div className="identity">
            <strong>{nameOf(user)}</strong>
            <span>{isAdmin(user) ? 'Platform admin' : 'Workspace user'}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={() => void handleLogout()}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dendrix AI internal deployment platform</p>
            <h1>{viewTitle(view)}</h1>
          </div>
          <div className="topbar-actions">
            {settings.announcementBanner || settings.announcement_banner ? (
              <span className="announcement">{settings.announcementBanner ?? settings.announcement_banner}</span>
            ) : null}
            <button className="button secondary" onClick={() => void refreshWorkspace()}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </header>

        <ErrorBanner message={error} />
        {loading ? <div className="inline-loader"><Loader2 className="spin" size={18} /> Loading workspace</div> : null}

        {view === 'apps' ? (
          <AppsView
            apps={filteredApps}
            allApps={apps}
            teams={teams}
            selectedApp={selectedApp}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
            search={search}
            onSearch={setSearch}
            onSelect={setSelectedAppId}
            onAppUpdated={replaceApp}
            onRefreshDetail={() => selectedApp ? void refreshDetail(selectedApp.id) : undefined}
            onAction={handleAppAction}
            onSecret={handleSecret}
            onRollback={handleRollback}
          />
        ) : null}

        {view === 'users' ? <UsersView users={users} teams={teams} onCreate={handleCreateUser} onUpdate={handleUpdateUser} /> : null}
        {view === 'teams' ? <TeamsView teams={teams} onCreate={handleCreateTeam} onTogglePause={handleToggleTeamPause} /> : null}
        {view === 'settings' ? (
          <SettingsView
            settings={settings}
            update={systemUpdate}
            onSave={handleSaveSettings}
            onCheckUpdate={handleCheckUpdate}
            onStartUpdate={handleStartUpdate}
            onDownloadBackup={handleDownloadBackup}
            onRestoreBackup={handleRestoreBackup}
          />
        ) : null}
        {view === 'tokens' ? <TokensView tokens={tokens} onCreate={handleCreateToken} onRevoke={handleRevokeToken} /> : null}
        {view === 'onboarding' ? <OnboardingView teams={teams} settings={settings} /> : null}
        {view === 'audit' ? <AuditView logs={auditLogs} /> : null}
      </main>
    </div>
  );

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setApps([]);
    setSelectedAppId(null);
  }

  function replaceApp(nextApp: AppSummary) {
    setApps((current) => current.map((app) => (app.id === nextApp.id ? { ...app, ...nextApp } : app)));
  }

  async function refreshApp(appId: string): Promise<AppSummary> {
    const nextApp = await api.getApp(appId);
    replaceApp(nextApp);
    return nextApp;
  }

  async function refreshAppUntilStatus(appId: string, expectedStatus: AppStatus): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await delay(800);
      const nextApp = await refreshApp(appId);
      if (nextApp.status === expectedStatus) {
        return;
      }
    }
  }

  async function handleAppAction(action: 'start' | 'stop' | 'delete' | 'postgres-create' | 'postgres-delete' | 'share', app: AppSummary, payload?: Partial<AppSummary>) {
    setDetailError(undefined);

    try {
      if (action === 'start' || action === 'stop') {
        const pendingStatus: AppStatus = action === 'start' ? 'starting' : 'stopping';
        const expectedStatus: AppStatus = action === 'start' ? 'running' : 'stopped';
        replaceApp({ ...app, status: pendingStatus });
        replaceApp(action === 'start' ? await api.startApp(app.id) : await api.stopApp(app.id));
        await refreshAppUntilStatus(app.id, expectedStatus);
        await refreshDetail(app.id);
        return;
      }
      if (action === 'delete') {
        await api.deleteApp(app.id);
        setApps((current) => current.filter((item) => item.id !== app.id));
      }
      if (action === 'postgres-create') {
        await api.createPostgres(app.id);
        replaceApp({ ...app, postgresEnabled: true, postgres_enabled: true });
      }
      if (action === 'postgres-delete') {
        await api.deletePostgres(app.id);
        replaceApp({ ...app, postgresEnabled: false, postgres_enabled: false });
      }
      if (action === 'share') replaceApp(await api.updateApp(app.id, payload ?? {}));
    } catch (caught) {
      if (action === 'start' || action === 'stop') {
        await refreshApp(app.id).catch(() => replaceApp(app));
      }
      setDetailError(formatApiError(caught));
    }
  }

  async function handleSecret(app: AppSummary, key: string, value?: string) {
    setDetailError(undefined);

    try {
      if (value === undefined) {
        await api.deleteSecret(app.id, key);
      } else {
        await api.upsertSecret(app.id, key, value);
      }
      await refreshDetail(app.id);
    } catch (caught) {
      setDetailError(formatApiError(caught));
    }
  }

  async function handleRollback(app: AppSummary, deploymentId: string) {
    setDetailError(undefined);

    try {
      await api.rollback(app.id, deploymentId);
      await refreshDetail(app.id);
    } catch (caught) {
      setDetailError(formatApiError(caught));
    }
  }

  async function handleCreateUser(payload: { email: string; displayName: string; password: string; isPlatformAdmin: boolean }) {
    const created = await api.createUser(payload);
    setUsers((current) => [...current, created]);
  }

  async function handleUpdateUser(userId: string, payload: Partial<User>) {
    const updated = await api.updateUser(userId, payload);
    setUsers((current) => current.map((item) => item.id === userId ? updated : item));
  }

  async function handleCreateTeam(payload: { name: string; slug: string }) {
    const created = await api.createTeam(payload);
    setTeams((current) => [...current, created]);
  }

  async function handleToggleTeamPause(team: Team) {
    const nextPaused = !(team.deploymentsPaused ?? team.deployments_paused);
    const updated = await api.updateTeam(team.id, { deploymentsPaused: nextPaused, deployments_paused: nextPaused });
    setTeams((current) => current.map((item) => item.id === team.id ? updated : item));
  }

  async function handleSaveSettings(payload: PlatformSettings) {
    setSettings(await api.updateSettings(payload));
  }

  async function handleCheckUpdate() {
    setSystemUpdate(await api.getSystemUpdate(true));
  }

  async function handleStartUpdate() {
    setSystemUpdate(await api.startSystemUpdate());
  }

  async function handleDownloadBackup() {
    const { blob, filename } = await api.downloadSystemBackup();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handleRestoreBackup(file: File): Promise<string> {
    const restore = await api.restoreSystemBackup(file);
    return restore.message;
  }

  async function handleCreateToken(name: string): Promise<ApiToken> {
    const created = await api.createToken(name);
    setTokens((current) => [created, ...current]);
    return created;
  }

  async function handleRevokeToken(tokenId: string) {
    await api.revokeToken(tokenId);
    setTokens((current) => current.filter((token) => token.id !== tokenId));
  }
}

function LoginScreen({ onLogin }: { onLogin: (user: User, teams: Team[]) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);

    try {
      const response = await api.login(email, password);
      onLogin(response.user, response.teams ?? response.memberships ?? []);
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="brand login-brand">
          <img className="brand-mark" src={dendrixLogo} alt="Dendrix AI logo" />
          <div>
            <strong>VibeStack</strong>
            <span>Community Edition by Dendrix AI</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">Dendrix AI protected platform</p>
          <h1>Sign in to manage deployed apps</h1>
          <p className="muted">Use your VibeStack account to review apps, secrets, logs, deployments, users, and platform settings in the Dendrix AI management console.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="admin@example.com" required />
          </label>
          <label>
            Password
            <div className="password-field">
              <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} required />
              <button type="button" onClick={() => setShowPassword((current) => !current)} title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <ErrorBanner message={error} />
          <button className="button primary wide" disabled={loading}>
            {loading ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
            Sign in
          </button>
        </form>
      </section>
      <section className="login-aside">
        <div className="metric-card">
          <Activity size={24} />
          <strong>Apps stay protected by default</strong>
          <span>Authentication, external password access, secrets, databases, logs, and rollbacks are operated centrally.</span>
        </div>
      </section>
    </div>
  );
}

function AppsView(props: {
  apps: AppSummary[];
  allApps: AppSummary[];
  teams: Team[];
  selectedApp: AppSummary | null;
  detail: DetailState;
  detailLoading: boolean;
  detailError?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onAppUpdated: (app: AppSummary) => void;
  onRefreshDetail: () => void;
  onAction: (action: 'start' | 'stop' | 'delete' | 'postgres-create' | 'postgres-delete' | 'share', app: AppSummary, payload?: Partial<AppSummary>) => void;
  onSecret: (app: AppSummary, key: string, value?: string) => void;
  onRollback: (app: AppSummary, deploymentId: string) => void;
}) {
  const running = props.allApps.filter((app) => app.status === 'running').length;
  const failed = props.allApps.filter((app) => app.status === 'failed').length;

  return (
    <div className="apps-layout">
      <section className="app-library">
        <div className="summary-grid">
          <Stat icon={AppWindow} label="Total apps" value={String(props.allApps.length)} />
          <Stat icon={CheckCircle2} label="Running" value={String(running)} tone="good" />
          <Stat icon={AlertTriangle} label="Needs attention" value={String(failed)} tone={failed > 0 ? 'bad' : 'neutral'} />
        </div>
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search apps, teams, hosts" />
          </div>
        </div>

        <div className="app-list">
          {props.apps.length === 0 ? (
            <EmptyState icon={AppWindow} title="No apps found" body="Apps deployed through the VibeStack API will appear here." />
          ) : props.apps.map((app) => (
            <button key={app.id} className={`app-row ${props.selectedApp?.id === app.id ? 'active' : ''}`} onClick={() => props.onSelect(app.id)}>
              <span className={`status-dot ${statusTone(app.status)}`} />
              <span>
                <strong>{app.name}</strong>
                <small>{teamName(props.teams, app)} / {app.slug}</small>
              </span>
              <em>{statusLabel(app.status)}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="app-detail">
        {props.selectedApp ? (
          <AppDetail {...props} app={props.selectedApp} />
        ) : (
          <EmptyState icon={LifeBuoy} title="Select an app" body="Choose an app to manage lifecycle, access, logs, secrets, Postgres, and rollback." />
        )}
      </section>
    </div>
  );
}

function AppDetail(props: Parameters<typeof AppsView>[0] & { app: AppSummary }) {
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [accessDraft, setAccessDraft] = useState({
    loginAccessEnabled: props.app.loginAccessEnabled ?? props.app.login_access_enabled ?? true,
    externalPasswordEnabled: props.app.externalPasswordEnabled ?? props.app.external_password_enabled ?? false,
    externalPassword: ''
  });
  const [showExternalPassword, setShowExternalPassword] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState('');
  const loginEnabled = props.app.loginAccessEnabled ?? props.app.login_access_enabled ?? true;
  const externalEnabled = props.app.externalPasswordEnabled ?? props.app.external_password_enabled ?? false;
  const postgresEnabled = props.app.postgresEnabled ?? props.app.postgres_enabled ?? false;
  const externalConfigured = props.app.externalPasswordConfigured ?? props.app.external_password_configured ?? externalEnabled;
  const url = appUrl(props.app);
  const rollbackOptions = props.detail.deployments.filter((deployment) => deployment.status === 'succeeded');
  const lifecycleBusy = ['deploying', 'starting', 'stopping', 'updating', 'deleting'].includes(props.app.status);
  const starting = props.app.status === 'starting';
  const stopping = props.app.status === 'stopping';

  useEffect(() => {
    setAccessDraft({
      loginAccessEnabled: props.app.loginAccessEnabled ?? props.app.login_access_enabled ?? true,
      externalPasswordEnabled: props.app.externalPasswordEnabled ?? props.app.external_password_enabled ?? false,
      externalPassword: ''
    });
    setRollbackTarget('');
  }, [props.app.id, props.app.loginAccessEnabled, props.app.login_access_enabled, props.app.externalPasswordEnabled, props.app.external_password_enabled]);

  function submitSecret(event: React.FormEvent) {
    event.preventDefault();
    const key = secretKey.trim();
    if (!key || !secretValue) return;
    props.onSecret(props.app, key, secretValue);
    setSecretKey('');
    setSecretValue('');
  }

  function saveAccess(event: React.FormEvent) {
    event.preventDefault();
    if (accessDraft.externalPasswordEnabled && (!externalConfigured || accessDraft.externalPassword) && accessDraft.externalPassword.length < 8) {
      window.alert('External password must be at least 8 characters.');
      return;
    }
    props.onAction('share', props.app, {
      loginAccessEnabled: accessDraft.loginAccessEnabled,
      externalPasswordEnabled: accessDraft.externalPasswordEnabled,
      ...(accessDraft.externalPassword ? { externalPassword: accessDraft.externalPassword } : {})
    });
    setAccessDraft((current) => ({ ...current, externalPassword: '' }));
  }

  function confirmAction(message: string, action: () => void) {
    if (window.confirm(message)) {
      action();
    }
  }

  return (
    <div className="detail-stack">
      <ErrorBanner message={props.detailError} />
      <div className="detail-hero">
        <div>
          <div className="crumb">{teamName(props.teams, props.app)} / {props.app.slug}</div>
          <h2>{props.app.name}</h2>
          <a href={url.startsWith('http') ? url : undefined} target="_blank" rel="noreferrer">{url}</a>
        </div>
        <span className={`status-pill ${statusTone(props.app.status)}`}>
          {lifecycleBusy ? <Loader2 className="spin" size={14} /> : null}
          {statusLabel(props.app.status)}
        </span>
      </div>

      <div className="control-strip">
        <button className="button primary" onClick={() => confirmAction(`Start ${props.app.name}?`, () => props.onAction('start', props.app))} disabled={lifecycleBusy || props.app.status === 'running'}>
          {starting ? <Loader2 className="spin" size={16} /> : <Play size={16} />} {starting ? 'Starting' : 'Start'}
        </button>
        <button className="button secondary" onClick={() => confirmAction(`Stop ${props.app.name}?`, () => props.onAction('stop', props.app))} disabled={lifecycleBusy || props.app.status === 'stopped'}>
          {stopping ? <Loader2 className="spin" size={16} /> : <Square size={16} />} {stopping ? 'Stopping' : 'Stop'}
        </button>
        <button className="button secondary danger" onClick={() => confirmAction(`Delete ${props.app.name}? This hides it from the management UI.`, () => props.onAction('delete', props.app))} disabled={lifecycleBusy}>
          <Trash2 size={16} /> Delete
        </button>
        <button className="button secondary" onClick={props.onRefreshDetail}>
          <RefreshCw size={16} /> Reload detail
        </button>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <PanelTitle icon={ShieldCheck} title="Sharing" />
          <form className="stack-form" onSubmit={saveAccess}>
            <label className="toggle">
              <input type="checkbox" checked={accessDraft.loginAccessEnabled} onChange={(event) => setAccessDraft({ ...accessDraft, loginAccessEnabled: event.target.checked })} />
              <span>Require logged-in VibeStack users</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={accessDraft.externalPasswordEnabled} onChange={(event) => setAccessDraft({ ...accessDraft, externalPasswordEnabled: event.target.checked })} />
              <span>Enable external password access</span>
            </label>
            {accessDraft.externalPasswordEnabled ? (
              <label>
                External password
                <div className="password-field">
                  <input
                    value={accessDraft.externalPassword}
                    onChange={(event) => setAccessDraft({ ...accessDraft, externalPassword: event.target.value })}
                    placeholder={externalConfigured ? 'Leave blank to keep current password' : 'At least 8 characters'}
                    type={showExternalPassword ? 'text' : 'password'}
                    minLength={8}
                    required={accessDraft.externalPasswordEnabled && !externalConfigured}
                  />
                  <button type="button" onClick={() => setShowExternalPassword((current) => !current)} title={showExternalPassword ? 'Hide password' : 'Show password'}>
                    {showExternalPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            ) : null}
            <button className="button primary"><ShieldCheck size={16} /> Save access</button>
          </form>
          <p className="muted">Current: {loginEnabled ? 'login required' : 'login optional'} / {externalEnabled ? 'external password on' : 'external password off'}</p>
        </section>

        <section className="panel">
          <PanelTitle icon={Database} title="Postgres" />
          <p className="muted">{postgresEnabled ? 'App database is provisioned and DATABASE_URL is injected.' : 'No app database is currently provisioned.'}</p>
          <button
            className={`button secondary ${postgresEnabled ? 'danger' : ''}`}
            onClick={() => confirmAction(
              postgresEnabled ? `Remove Postgres from ${props.app.name}? Existing credentials will be disabled.` : `Provision Postgres for ${props.app.name}?`,
              () => props.onAction(postgresEnabled ? 'postgres-delete' : 'postgres-create', props.app)
            )}
          >
            <Database size={16} /> {postgresEnabled ? 'Remove database' : 'Provision database'}
          </button>
        </section>

        <section className="panel span-2">
          <PanelTitle icon={KeyRound} title="Secrets" />
          <form className="secret-form" onSubmit={submitSecret}>
            <input value={secretKey} onChange={(event) => setSecretKey(event.target.value.toUpperCase())} placeholder="SECRET_KEY" />
            <input value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="New value" type="password" />
            <button className="button primary"><KeyRound size={16} /> Save</button>
          </form>
          <div className="secret-list">
            {props.detail.secrets.length === 0 ? <p className="muted">No secrets configured.</p> : props.detail.secrets.map((secret) => (
              <div key={secret.key}>
                <code>{secret.key}</code>
                <span>Updated {formatDate(secret.updatedAt ?? secret.updated_at)}</span>
                <button className="icon-button danger" title="Delete secret" onClick={() => confirmAction(`Delete secret ${secret.key}?`, () => props.onSecret(props.app, secret.key))}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="detail-grid">
        <section className="panel span-2">
          <PanelTitle icon={History} title="Deployment history" />
          {props.detailLoading ? <div className="inline-loader"><Loader2 className="spin" size={16} /> Loading deployments</div> : null}
          <div className="rollback-row">
            <select value={rollbackTarget} onChange={(event) => setRollbackTarget(event.target.value)}>
              <option value="">Select rollback target</option>
              {rollbackOptions.map((deployment) => (
                <option key={deployment.id} value={deployment.id}>
                  v{deploymentVersion(deployment) ?? '-'} / {formatDate(deploymentStartedAt(deployment))}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              disabled={!rollbackTarget}
              onClick={() => confirmAction('Queue rollback to the selected deployment?', () => props.onRollback(props.app, rollbackTarget))}
            >
              <RotateCcw size={16} /> Roll back
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Version</th><th>Type</th><th>Status</th><th>Started</th><th>Error</th><th /></tr>
              </thead>
              <tbody>
                {props.detail.deployments.length === 0 ? (
                  <tr><td colSpan={6}>No deployment history.</td></tr>
                ) : props.detail.deployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td>v{deploymentVersion(deployment) ?? '-'}</td>
                    <td>{deployment.type}</td>
                    <td><span className={`status-pill ${statusTone(deployment.status)}`}>{deployment.status}</span></td>
                    <td>{formatDate(deploymentStartedAt(deployment))}</td>
                    <td>{deploymentError(deployment) ?? '-'}</td>
                    <td>
                      {deployment.status === 'succeeded' ? (
                        <button className="icon-button" title="Select rollback target" onClick={() => setRollbackTarget(deployment.id)}>
                          <RotateCcw size={15} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={Clock3} title="Lifecycle events" />
          <div className="timeline">
            {props.detail.events.length === 0 ? <p className="muted">No lifecycle events.</p> : props.detail.events.map((event) => (
              <div key={event.id}>
                <span />
                <strong>{event.eventType ?? event.event_type ?? 'event'}</strong>
                <p>{event.message}</p>
                <small>{formatDate(event.createdAt ?? event.created_at)}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel span-3">
          <PanelTitle icon={TerminalSquare} title="Logs" />
          <pre className="logs">
            {props.detail.logs.length === 0
              ? 'No logs available.'
              : props.detail.logs.map((line) => `[${formatDate(line.timestamp)}] ${line.level ?? line.stream ?? 'log'} ${line.message}`).join('\n')}
          </pre>
        </section>
      </div>
    </div>
  );
}

function UsersView({ users, onCreate, onUpdate }: { users: User[]; teams: Team[]; onCreate: (payload: { email: string; displayName: string; password: string; isPlatformAdmin: boolean }) => Promise<void>; onUpdate: (userId: string, payload: Partial<User>) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await onCreate({ email, displayName, password, isPlatformAdmin });
      setEmail('');
      setDisplayName('');
      setPassword('');
      setIsPlatformAdmin(false);
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  return (
    <section className="admin-grid">
      <div className="panel">
        <PanelTitle icon={Users} title="Create user" />
        <form className="stack-form" onSubmit={submit}>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" required />
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" type="email" required />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Initial password" type="password" minLength={8} required />
          <label className="toggle compact"><input type="checkbox" checked={isPlatformAdmin} onChange={(event) => setIsPlatformAdmin(event.target.checked)} /> Platform admin</label>
          <ErrorBanner message={error} />
          <button className="button primary"><Users size={16} /> Create user</button>
        </form>
      </div>
      <div className="panel admin-main">
        <PanelTitle icon={ShieldCheck} title="Users" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Role</th><th /></tr></thead>
            <tbody>
              {users.length === 0 ? <tr><td colSpan={5}>No users returned by the API.</td></tr> : users.map((user) => (
                <tr key={user.id}>
                  <td>{nameOf(user)}</td>
                  <td>{user.email}</td>
                  <td>{user.status ?? 'active'}</td>
                  <td>{isAdmin(user) ? 'platform_admin' : 'member'}</td>
                  <td>
                    <button className="button small secondary" onClick={() => void onUpdate(user.id, { status: user.status === 'disabled' ? 'active' : 'disabled' })}>
                      {user.status === 'disabled' ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TeamsView({ teams, onCreate, onTogglePause }: { teams: Team[]; onCreate: (payload: { name: string; slug: string }) => Promise<void>; onTogglePause: (team: Team) => Promise<void> }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await onCreate({ name, slug });
      setName('');
      setSlug('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  return (
    <section className="admin-grid">
      <div className="panel">
        <PanelTitle icon={ShieldCheck} title="Create team" />
        <form className="stack-form" onSubmit={submit}>
          <input value={name} onChange={(event) => { setName(event.target.value); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} placeholder="Team name" required />
          <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="team-slug" required />
          <ErrorBanner message={error} />
          <button className="button primary"><ShieldCheck size={16} /> Create team</button>
        </form>
      </div>
      <div className="panel admin-main">
        <PanelTitle icon={Users} title="Teams" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Slug</th><th>Deployment status</th><th>Members</th><th /></tr></thead>
            <tbody>
              {teams.length === 0 ? <tr><td colSpan={5}>No teams returned by the API.</td></tr> : teams.map((team) => {
                const paused = team.deploymentsPaused ?? team.deployments_paused ?? false;
                return (
                  <tr key={team.id}>
                    <td>{team.name}</td>
                    <td><code>{team.slug}</code></td>
                    <td><span className={`status-pill ${paused ? 'bad' : 'good'}`}>{paused ? 'paused' : 'active'}</span></td>
                    <td>{team.members?.length ?? 0}</td>
                    <td><button className="button small secondary" onClick={() => void onTogglePause(team)}>{paused ? 'Resume' : 'Pause'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SettingsView({
  settings,
  update,
  onSave,
  onCheckUpdate,
  onStartUpdate,
  onDownloadBackup,
  onRestoreBackup
}: {
  settings: PlatformSettings;
  update?: SystemUpdate;
  onSave: (payload: PlatformSettings) => Promise<void>;
  onCheckUpdate: () => Promise<void>;
  onStartUpdate: () => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  onRestoreBackup: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState<PlatformSettings>(settings);
  const [cloudflareToken, setCloudflareToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [updateBusy, setUpdateBusy] = useState<'check' | 'apply'>();
  const [backupBusy, setBackupBusy] = useState<'download' | 'restore'>();
  const [error, setError] = useState<string>();
  const [systemMessage, setSystemMessage] = useState<string>();

  useEffect(() => {
    setDraft(settings);
    setCloudflareToken('');
  }, [settings]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(undefined);
    try {
      await onSave({
        baseDomain: readSetting(draft, 'baseDomain', 'base_domain', ''),
        dataDirectory: readSetting(draft, 'dataDirectory', 'data_directory', ''),
        buildTimeoutSeconds: readSetting(draft, 'buildTimeoutSeconds', 'build_timeout_seconds', 900),
        updateChannel: readSetting(draft, 'updateChannel', 'update_channel', 'stable'),
        defaultAppAccessMode: readSetting(draft, 'defaultAppAccessMode', 'default_app_access_mode', readSetting(draft, 'defaultAccessMode', 'default_access_mode', 'login')),
        maintenanceMode: readSetting(draft, 'maintenanceMode', 'maintenance_mode', false),
        announcementBanner: readSetting(draft, 'announcementBanner', 'announcement_banner', ''),
        cloudflare: {
          ...(draft.cloudflare ?? {}),
          ...(cloudflareToken ? { apiToken: cloudflareToken } : {})
        }
      });
      setSaved(true);
      setCloudflareToken('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  const cloudflare = draft.cloudflare ?? {};
  const cloudflareZoneId = cloudflare.zoneId ?? cloudflare.zone_id ?? '';
  const cloudflareConfigured = Boolean(cloudflare.configured ?? cloudflare.apiTokenConfigured ?? cloudflare.api_token_configured);
  const updateAvailable = Boolean(update?.updateAvailable);
  const updateRunning = update?.state === 'running';
  const currentVersionLabel = versionLabel(update?.currentVersion, update?.currentTag, update?.currentRevision);
  const latestVersionLabel = versionLabel(update?.latestVersion, update?.latestTag, update?.latestRevision);
  const selectedChannel = readSetting(draft, 'updateChannel', 'update_channel', update?.channel ?? 'stable');
  const updateBlocked = Boolean(update?.schema && !update.schema.compatible);

  async function checkUpdate() {
    setError(undefined);
    setSystemMessage(undefined);
    setUpdateBusy('check');
    try {
      await onCheckUpdate();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setUpdateBusy(undefined);
    }
  }

  async function startUpdate() {
    setError(undefined);
    setSystemMessage(undefined);
    setUpdateBusy('apply');
    try {
      await onStartUpdate();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setUpdateBusy(undefined);
    }
  }

  async function downloadBackup() {
    setError(undefined);
    setSystemMessage(undefined);
    setBackupBusy('download');
    try {
      await onDownloadBackup();
      setSystemMessage('Backup downloaded.');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBackupBusy(undefined);
    }
  }

  async function restoreBackup(file?: File, input?: HTMLInputElement) {
    if (!file) return;
    const confirmed = window.confirm('Restore this backup? This replaces VibeStack database/configuration state and should be followed by a stack restart.');
    if (!confirmed) return;
    setError(undefined);
    setSystemMessage(undefined);
    setBackupBusy('restore');
    try {
      setSystemMessage(await onRestoreBackup(file));
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      if (input) input.value = '';
      setBackupBusy(undefined);
    }
  }

  return (
    <form className="settings-grid" onSubmit={submit}>
      <section className="panel">
        <PanelTitle icon={Settings} title="Platform" />
        <label>Base domain<input value={readSetting(draft, 'baseDomain', 'base_domain', '')} onChange={(event) => setDraft({ ...draft, baseDomain: event.target.value })} /></label>
        <label>Data directory<input value={readSetting(draft, 'dataDirectory', 'data_directory', '')} onChange={(event) => setDraft({ ...draft, dataDirectory: event.target.value })} /></label>
        <label>Build timeout seconds<input type="number" value={readSetting(draft, 'buildTimeoutSeconds', 'build_timeout_seconds', 900)} onChange={(event) => setDraft({ ...draft, buildTimeoutSeconds: Number(event.target.value) })} /></label>
      </section>
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Access and operations" />
        <label>Default app access mode<select value={readSetting(draft, 'defaultAppAccessMode', 'default_app_access_mode', readSetting(draft, 'defaultAccessMode', 'default_access_mode', 'login'))} onChange={(event) => setDraft({ ...draft, defaultAppAccessMode: event.target.value })}><option value="login">Logged-in users</option><option value="password">External password</option><option value="private">Private</option></select></label>
        <label className="toggle"><input type="checkbox" checked={readSetting(draft, 'maintenanceMode', 'maintenance_mode', false)} onChange={(event) => setDraft({ ...draft, maintenanceMode: event.target.checked })} /> Maintenance mode</label>
        <label>Announcement banner<textarea value={readSetting(draft, 'announcementBanner', 'announcement_banner', '')} onChange={(event) => setDraft({ ...draft, announcementBanner: event.target.value })} /></label>
      </section>
      <section className="panel">
        <PanelTitle icon={Cloud} title="Cloudflare" />
        <label>Zone ID<input value={cloudflareZoneId} onChange={(event) => setDraft({ ...draft, cloudflare: { ...cloudflare, zoneId: event.target.value } })} /></label>
        <label>API token<input value={cloudflareToken} onChange={(event) => setCloudflareToken(event.target.value)} placeholder={cloudflareConfigured ? 'Leave blank to keep existing token' : 'Paste token to configure DNS'} type="password" /></label>
        <p className="muted">Cloudflare token values are write-only. The backend returns status flags instead of token material.</p>
        <span className={`status-pill ${cloudflareConfigured ? 'good' : 'neutral'}`}>
          {cloudflareConfigured ? 'configured' : 'not configured'}
        </span>
      </section>
      <section className="panel">
        <PanelTitle icon={GitBranch} title="Version" />
        <label>Update channel<select value={selectedChannel} onChange={(event) => setDraft({ ...draft, updateChannel: event.target.value })}><option value="stable">Stable</option><option value="beta">Beta</option><option value="nightly">Nightly</option><option value="main">Main</option></select></label>
        <dl className="version-list">
          <div><dt>Current version</dt><dd>{currentVersionLabel}</dd></div>
          <div><dt>Latest version</dt><dd>{latestVersionLabel}</dd></div>
          <div><dt>Current build</dt><dd>{shortRevision(update?.currentRevision)}</dd></div>
          <div><dt>Latest build</dt><dd>{shortRevision(update?.latestRevision)}</dd></div>
          <div><dt>Channel</dt><dd>{update?.channel ?? 'stable'}</dd></div>
        </dl>
        <span className={`status-pill ${updateRunning ? 'busy' : updateAvailable ? 'good' : update?.sourceAvailable === false ? 'bad' : 'neutral'}`}>
          {updateRunning ? <Loader2 className="spin" size={14} /> : null}
          {updateRunning ? 'updating' : updateAvailable ? 'update available' : update?.sourceAvailable === false ? 'unavailable' : 'up to date'}
        </span>
        {update?.message ? <p className="muted">{update.message}</p> : null}
        {update?.schema?.message ? <p className={update.schema.compatible ? 'muted' : 'danger-text'}>{update.schema.message}</p> : null}
        {update?.schema?.backupRecommended ? <p className="muted">Create a backup before applying this update.</p> : null}
        <div className="button-row">
          <button type="button" className="button secondary" onClick={() => void checkUpdate()} disabled={Boolean(updateBusy) || updateRunning}>
            {updateBusy === 'check' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Check
          </button>
          <button type="button" className="button primary" onClick={() => void startUpdate()} disabled={!updateAvailable || updateBlocked || Boolean(updateBusy) || updateRunning}>
            {updateBusy === 'apply' || updateRunning ? <Loader2 className="spin" size={16} /> : <Download size={16} />} {updateRunning ? 'Updating' : 'Update'}
          </button>
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Download} title="Backup and restore" />
        <p className="muted">Download a system backup before channel changes or restore a previous VibeStack backup archive.</p>
        <div className="button-row">
          <button type="button" className="button secondary" onClick={() => void downloadBackup()} disabled={Boolean(backupBusy)}>
            {backupBusy === 'download' ? <Loader2 className="spin" size={16} /> : <Download size={16} />} Download backup
          </button>
          <label className={`button secondary ${backupBusy ? 'disabled-like' : ''}`}>
            {backupBusy === 'restore' ? <Loader2 className="spin" size={16} /> : <Upload size={16} />} Restore backup
            <input type="file" accept=".tar.gz,.tgz,application/gzip" hidden disabled={Boolean(backupBusy)} onChange={(event) => void restoreBackup(event.target.files?.[0], event.currentTarget)} />
          </label>
        </div>
      </section>
      <div className="settings-actions">
        <ErrorBanner message={error} />
        {systemMessage ? <div className="banner success"><CheckCircle2 size={18} /> {systemMessage}</div> : null}
        {saved ? <div className="banner success"><CheckCircle2 size={18} /> Settings saved</div> : null}
        <button className="button primary"><Settings size={16} /> Save settings</button>
      </div>
    </form>
  );
}

function TokensView({ tokens, onCreate, onRevoke }: { tokens: ApiToken[]; onCreate: (name: string) => Promise<ApiToken>; onRevoke: (tokenId: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<ApiToken | null>(null);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setCreatedToken(null);
    try {
      const created = await onCreate(name.trim());
      setCreatedToken(created);
      setName('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  async function revoke(token: ApiToken) {
    if (!window.confirm(`Revoke API token ${token.name}?`)) return;
    setError(undefined);
    try {
      await onRevoke(token.id);
      if (createdToken?.id === token.id) setCreatedToken(null);
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  return (
    <section className="admin-grid">
      <div className="panel">
        <PanelTitle icon={KeyRound} title="Create API token" />
        <form className="stack-form" onSubmit={submit}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Token name" required />
          <ErrorBanner message={error} />
          <button className="button primary"><KeyRound size={16} /> Create token</button>
        </form>
      </div>

      <div className="panel admin-main">
        <PanelTitle icon={ShieldCheck} title="API tokens" />
        {createdToken?.value ? (
          <div className="banner success token-reveal">
            <CheckCircle2 size={18} />
            <span>Copy this token now. It will not be shown again.</span>
            <code>{createdToken.value}</code>
            <button className="icon-button" title="Copy token" onClick={() => void navigator.clipboard.writeText(createdToken.value ?? '')}>
              <Copy size={15} />
            </button>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {tokens.length === 0 ? <tr><td colSpan={4}>No API tokens returned by the API.</td></tr> : tokens.map((token) => (
                <tr key={token.id}>
                  <td>{token.name}</td>
                  <td>{formatDate(token.createdAt ?? token.created_at)}</td>
                  <td>{formatDate(token.lastUsedAt ?? token.last_used_at)}</td>
                  <td><button className="button small secondary danger" onClick={() => void revoke(token)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function OnboardingView({ teams, settings }: { teams: Team[]; settings: PlatformSettings }) {
  const baseDomain = readSetting(settings, 'baseDomain', 'base_domain', '');
  const defaultAccessMode = readSetting(settings, 'defaultAppAccessMode', 'default_app_access_mode', readSetting(settings, 'defaultAccessMode', 'default_access_mode', 'login'));
  const [apiUrl, setApiUrl] = useState(window.location.origin);
  const [appDomain, setAppDomain] = useState(baseDomain);
  const [teamSlug, setTeamSlug] = useState(teams[0]?.slug ?? '');
  const [accessMode, setAccessMode] = useState(defaultAccessMode);
  const [postgresDefault, setPostgresDefault] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAppDomain((current) => current || baseDomain);
  }, [baseDomain]);

  useEffect(() => {
    setTeamSlug((current) => current || teams[0]?.slug || '');
  }, [teams]);

  const accessText = accessMode === 'password'
    ? 'external-password access'
    : accessMode === 'private'
      ? 'private access'
      : 'VibeStack login access';

  const prompt = useMemo(() => `I want you to install the reusable VibeStack deployment skill in Claude Code.

Use these defaults:
- VibeStack API URL: ${apiUrl || 'https://vibestack.example.com'}
- Hosted app base domain: ${appDomain || 'apps.example.com'}
- Default team slug: ${teamSlug || 'team-slug'}
- Default access mode: ${accessText}
- Default database behavior: ${postgresDefault ? 'enable VibeStack-managed Postgres for new apps' : 'no Postgres unless I explicitly ask for persistent structured data'}

Ask me for my VibeStack API token. Do not print the token back to me. Do not commit it. Do not store it in any app repository. If Claude Code has a secure local user-level secrets mechanism, use that; otherwise store it in a user-level config file with permissions set to 0600.

Then install the VibeStack deployment skill:
1. Fetch https://github.com/Dendrix-AI/vibestack.
2. Copy skills/deploy-to-vibestack into the local Claude Code skills directory as deploy-to-vibestack.
3. Verify the installed skill contains SKILL.md, scripts/vibestack_deploy.py, references/api.md, and references/manifest.md.
4. Create ~/.config/vibestack/deploy.json with the defaults above.
5. Store credentials only in a user-level credentials file or secure local secrets store.
6. Do not deploy the current app unless I explicitly ask you to.

After setup, explain that I can deploy any future app by opening that app in Claude Code and saying: "Deploy this app to VibeStack."`, [accessText, apiUrl, appDomain, postgresDefault, teamSlug]);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="admin-grid">
      <div className="panel">
        <PanelTitle icon={ClipboardList} title="Creator handoff" />
        <form className="stack-form">
          <label>Management URL<input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} /></label>
          <label>Hosted app base domain<input value={appDomain} onChange={(event) => setAppDomain(event.target.value)} placeholder="apps.example.com" /></label>
          <label>Team slug<select value={teamSlug} onChange={(event) => setTeamSlug(event.target.value)}>
            <option value="">Select team</option>
            {teams.map((team) => <option key={team.id} value={team.slug}>{team.name} / {team.slug}</option>)}
          </select></label>
          <label>Default access<select value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
            <option value="login">Logged-in users</option>
            <option value="password">External password</option>
            <option value="private">Private</option>
          </select></label>
          <label className="toggle compact"><input type="checkbox" checked={postgresDefault} onChange={(event) => setPostgresDefault(event.target.checked)} /> Default Postgres</label>
          <button type="button" className="button primary" onClick={() => void copyPrompt()}>
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </form>
      </div>

      <div className="panel admin-main">
        <PanelTitle icon={TerminalSquare} title="Claude Code setup prompt" />
        <textarea className="prompt-preview" value={prompt} readOnly />
      </div>
    </section>
  );
}

function AuditView({ logs }: { logs: AuditLog[] }) {
  return (
    <section className="panel">
      <PanelTitle icon={BookOpen} title="Audit logs" />
      <div className="table-wrap dense">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Source IP</th></tr></thead>
          <tbody>
            {logs.length === 0 ? <tr><td colSpan={5}>No audit events returned by the API.</td></tr> : logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.createdAt ?? log.created_at)}</td>
                <td>{auditActor(log)}</td>
                <td><code>{log.action}</code></td>
                <td>{auditTarget(log)}</td>
                <td>{log.sourceIp ?? log.source_ip ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function auditActor(log: AuditLog): string {
  const actorType = log.actorType ?? log.actor_type ?? 'system';
  if (actorType === 'system') return 'system';

  const name = log.actorUserDisplayName ?? log.actor_user_display_name ?? log.actorUserEmail ?? log.actor_user_email;
  if (!name) return actorType;
  return actorType === 'api_token' ? `${name} (API token)` : name;
}

function auditTarget(log: AuditLog): string {
  const targetType = log.targetType ?? log.target_type ?? '-';
  const fallbackId = log.targetId ?? log.target_id ?? '';

  if (targetType === 'user') {
    return log.targetUserDisplayName ?? log.target_user_display_name ?? log.targetUserEmail ?? log.target_user_email ?? fallbackId;
  }

  if (targetType === 'app') {
    const appName = log.targetAppName ?? log.target_app_name;
    const hostname = log.targetAppHostname ?? log.target_app_hostname;
    return appName ? `${appName}${hostname ? ` (${hostname})` : ''}` : fallbackId;
  }

  if (targetType === 'team') {
    return log.targetTeamName ?? log.target_team_name ?? fallbackId;
  }

  return fallbackId ? `${targetType} ${fallbackId}` : targetType;
}

function Stat({ icon: Icon, label, value, tone = 'neutral' }: { icon: typeof AppWindow; label: string; value: string; tone?: string }) {
  return (
    <div className={`stat ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof AppWindow; title: string }) {
  return (
    <div className="panel-title">
      <Icon size={18} />
      <h3>{title}</h3>
    </div>
  );
}

function viewTitle(view: View): string {
  switch (view) {
    case 'apps':
      return 'App library';
    case 'users':
      return 'Users';
    case 'teams':
      return 'Teams';
    case 'settings':
      return 'Platform settings';
    case 'tokens':
      return 'API tokens';
    case 'onboarding':
      return 'Creator onboarding';
    case 'audit':
      return 'Audit logs';
  }
}

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
