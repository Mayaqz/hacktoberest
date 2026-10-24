import { useQuery } from "@apollo/client";
import type { ReactNode } from "react";
import { IconSchool, IconSettings } from "@tabler/icons-react";
import { Badge, Breadcrumb, Button, Card, Separator, Skeleton } from "erxes-ui";
import { PageHeader } from "ui-modules";
import { Link } from "react-router";
import manifest from "../../../erxes.json" with { type: "json" };
import { STATUS_QUERY } from "../graphql";

const { path } = manifest.ui;

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="subedei:contents">
    <dt className="subedei:text-muted-foreground">{label}</dt>
    <dd>{children}</dd>
  </div>
);

const Status = () => {
  const { data, loading, error, refetch } = useQuery(STATUS_QUERY);
  if (loading) return <Skeleton className="subedei:h-32 subedei:w-full" />;
  if (error) {
    return (
      <div className="subedei:text-sm">
        <p className="subedei:text-destructive">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Дахин ачаалах
        </Button>
      </div>
    );
  }
  const s = data?.subedeiStatus;
  if (!s) return null;
  return (
    <dl className="subedei:grid subedei:grid-cols-[10rem_1fr] subedei:gap-y-2 subedei:text-sm">
      <Row label="Сургууль">{s.school}</Row>
      <Row label="Gemma">
        <Badge variant={s.llmReachable ? "success" : "warning"}>
          {s.llmModel} · {s.llmReachable ? "ажиллаж байна" : "холбогдоогүй (дүрмийн задлагч)"}
        </Badge>
      </Row>
      <Row label="Яриа (TTS / STT)">
        {s.tts === "oyu" ? "Oyu" : "browser"} / {s.stt === "oyu" ? "Oyu" : "browser"}
      </Row>
      <Row label="SMS">{s.sms === "http" ? "SMS gateway" : "симулятор"}</Row>
      <Row label="Contacts синк">{s.erxesSync ? "идэвхтэй" : "унтраалттай"}</Row>
      <Row label="Tenant">{s.subdomain}</Row>
      <Row label="Хэрэглэгч">{s.userEmail ?? s.userId ?? "—"}</Row>
      <Row label="Хувилбар">v{s.version}</Row>
    </dl>
  );
};

export const SettingsPage = () => (
  <div className="subedei:flex subedei:h-full subedei:flex-col">
    <PageHeader>
      <PageHeader.Start>
        <Breadcrumb>
          <Breadcrumb.List className="subedei:gap-1">
            <Breadcrumb.Item>
              <Button variant="ghost" asChild>
                <Link to={`/${path}/settings`}>
                  <IconSettings />
                  {manifest.title} · тохиргоо
                </Link>
              </Button>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
        <Separator.Inline />
        <PageHeader.FavoriteToggleButton breadcrumb={[manifest.title, "тохиргоо"]} icon="IconSettings" />
      </PageHeader.Start>
      <PageHeader.End>
        <Button variant="outline" asChild>
          <Link to={`/${path}`}>
            <IconSchool />
            Өнөөдөр
          </Link>
        </Button>
      </PageHeader.End>
    </PageHeader>
    <div className="subedei:flex-1 subedei:overflow-auto">
      <div className="subedei:mx-auto subedei:flex subedei:w-full subedei:max-w-3xl subedei:flex-col subedei:gap-6 subedei:p-6">
        <Card>
          <Card.Header>
            <Card.Title>Холболтууд</Card.Title>
            <Card.Description>
              Тохиргоог plugin API-ийн орчны хувьсагчаар (.env) өөрчилнө: LLM_*, OYU_*, SMS_*, ERXES_*.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Status />
          </Card.Content>
        </Card>
      </div>
    </div>
  </div>
);
