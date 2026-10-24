import { useQuery } from "@apollo/client";
import { IconPhoneCall } from "@tabler/icons-react";
import { Badge, Breadcrumb, Button, Card, Separator, Skeleton } from "erxes-ui";
import { PageHeader } from "ui-modules";
import { Link } from "react-router";
import manifest from "../../../erxes.json" with { type: "json" };
import { CALLS_QUERY } from "../graphql";
import { CALL_LABELS, PURPOSE_LABELS, callTone, formatTime, modelLabel } from "../labels";

const { path } = manifest.ui;

const CallList = () => {
  const { data, loading, error, refetch } = useQuery(CALLS_QUERY, { variables: { limit: 50 }, pollInterval: 4000 });

  if (loading && !data) return <Skeleton className="subedei:h-40 subedei:w-full" />;
  if (error) {
    return (
      <Card className="subedei:p-6 subedei:text-sm">
        <p className="subedei:text-destructive">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Дахин ачаалах
        </Button>
      </Card>
    );
  }
  const calls = data?.subedeiCalls ?? [];
  if (!calls.length) {
    return <Card className="subedei:p-6 subedei:text-sm subedei:text-muted-foreground">Одоогоор дуудлага алга.</Card>;
  }

  return (
    <div className="subedei:flex subedei:flex-col subedei:gap-3">
      {calls.map((call) => (
        <Card key={call._id} className="subedei:p-4 subedei:text-sm">
          <div className="subedei:flex subedei:flex-wrap subedei:items-center subedei:gap-2">
            <Badge variant={callTone(call.status)}>{CALL_LABELS[call.status]}</Badge>
            <span className="subedei:font-medium">{PURPOSE_LABELS[call.purpose]}</span>
            <span className="subedei:text-muted-foreground">
              {call.guardian ? `${call.guardian.relation} ${call.guardian.name} ${call.guardian.phone}` : ""} ·{" "}
              {formatTime(call.ringingAt)} · {call.attempt}-р оролдлого
            </span>
          </div>
          {call.transcript && <p className="subedei:mt-2">🗣️ “{call.transcript}”</p>}
          {call.intent?.summary && (
            <p className="subedei:mt-1 subedei:text-muted-foreground">
              {call.intent.engine === "llm" ? modelLabel(call.intent.model) : "Дүрэм"}: {call.intent.summary}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
};

export const CallsPage = () => (
  <div className="subedei:flex subedei:h-full subedei:flex-col">
    <PageHeader>
      <PageHeader.Start>
        <Breadcrumb>
          <Breadcrumb.List className="subedei:gap-1">
            <Breadcrumb.Item>
              <Button variant="ghost" asChild>
                <Link to={`/${path}/calls`}>
                  <IconPhoneCall />
                  Дуудлага
                </Link>
              </Button>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
        <Separator.Inline />
        <PageHeader.FavoriteToggleButton breadcrumb={[manifest.title, "Дуудлага"]} icon="IconPhoneCall" />
      </PageHeader.Start>
    </PageHeader>
    <div className="subedei:flex-1 subedei:overflow-auto">
      <div className="subedei:mx-auto subedei:w-full subedei:max-w-4xl subedei:p-6">
        <CallList />
      </div>
    </div>
  </div>
);
