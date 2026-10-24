import { useMutation, useQuery } from "@apollo/client";
import { IconAlarm, IconPhoneCall, IconSchool, IconSettings } from "@tabler/icons-react";
// Root imports on purpose: core-ui shares `erxes-ui`/`ui-modules` as Module
// Federation singletons keyed on the bare specifier, so deep imports would
// bundle second private copies instead of reusing the host's.
import { Badge, Breadcrumb, Button, Card, Separator, Skeleton } from "erxes-ui";
import { PageHeader } from "ui-modules";
import { Link } from "react-router";
import manifest from "../../../erxes.json" with { type: "json" };
import { CALL_GUARDIANS, CHECK_LATE_PICKUPS, MARK_ATTENDANCE, MARK_PICKED_UP, TODAY_QUERY } from "../graphql";
import {
  ATTENDANCE_LABELS,
  CALL_LABELS,
  PICKUP_LABELS,
  PICKUP_TONE,
  PURPOSE_LABELS,
  callTone,
  formatTime,
} from "../labels";

const { path } = manifest.ui;
const ATTENDANCE_CHOICES = ["present", "absent", "late", "excused"] as const;

const Kpi = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <Card className="subedei:p-4">
    <div className={`subedei:text-2xl subedei:font-semibold ${tone ?? ""}`}>{value}</div>
    <div className="subedei:text-sm subedei:text-muted-foreground">{label}</div>
  </Card>
);

const TodayTable = () => {
  // Calls and replies change server-side; poll so the board stays live.
  const { data, loading, error, refetch } = useQuery(TODAY_QUERY, { pollInterval: 4000 });
  const refetchQueries = [{ query: TODAY_QUERY }];
  const [markAttendance] = useMutation(MARK_ATTENDANCE, { refetchQueries });
  const [markPickedUp] = useMutation(MARK_PICKED_UP, { refetchQueries });
  const [callGuardians] = useMutation(CALL_GUARDIANS, { refetchQueries });
  const [checkLate, { loading: checking }] = useMutation(CHECK_LATE_PICKUPS, { refetchQueries });

  if (loading && !data) {
    return (
      <div className="subedei:flex subedei:flex-col subedei:gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="subedei:h-12 subedei:w-full" />
        ))}
      </div>
    );
  }

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

  const today = data?.subedeiToday;
  if (!today || !today.students.length) {
    return <Card className="subedei:p-6 subedei:text-sm subedei:text-muted-foreground">Сурагч бүртгэгдээгүй байна.</Card>;
  }

  const c = today.counts;
  return (
    <div className="subedei:flex subedei:flex-col subedei:gap-4">
      <div className="subedei:flex subedei:flex-wrap subedei:items-center subedei:justify-between subedei:gap-2">
        <h2 className="subedei:text-lg subedei:font-semibold">
          {today.classroomName} анги · {today.date} · тарах {today.pickupTime}
        </h2>
        <Button onClick={() => checkLate()} disabled={checking}>
          <IconAlarm />
          Хоцорсон авалтыг одоо шалгах
        </Button>
      </div>

      <div className="subedei:grid subedei:grid-cols-2 subedei:gap-3 subedei:md:grid-cols-6">
        <Kpi label="Нийт" value={c.total} />
        <Kpi label="Ирсэн" value={c.present + c.late} tone="subedei:text-success" />
        <Kpi label="Тасалсан" value={c.absent + c.excused} tone={c.absent ? "subedei:text-destructive" : ""} />
        <Kpi label="Авсан" value={c.pickedUp} />
        <Kpi label="Хүлээгдэж буй" value={c.waiting + c.contacting + c.coming} tone="subedei:text-info" />
        <Kpi label="Холбогдсонгүй" value={c.unreachable} tone={c.unreachable ? "subedei:text-destructive" : ""} />
      </div>

      <Card className="subedei:overflow-x-auto">
        <table className="subedei:w-full subedei:text-sm">
          <thead>
            <tr className="subedei:border-b subedei:border-border subedei:text-left subedei:text-muted-foreground">
              <th className="subedei:p-3">Сурагч</th>
              <th className="subedei:p-3">Ирц</th>
              <th className="subedei:p-3">Хүүхэд авалт</th>
              <th className="subedei:p-3">Сүүлийн дуудлага</th>
              <th className="subedei:p-3" />
            </tr>
          </thead>
          <tbody>
            {today.students.map((s) => {
              const present = s.attendance === "present" || s.attendance === "late";
              const pickup = s.pickup.status;
              return (
                <tr key={s.studentId} className="subedei:border-b subedei:border-border subedei:align-top">
                  <td className="subedei:p-3">
                    <div className="subedei:font-medium">
                      {s.firstName} {s.lastName}
                    </div>
                    <div className="subedei:text-xs subedei:text-muted-foreground">
                      {s.guardians.map((g) => `${g.relation} ${g.phone}`).join(" · ")}
                    </div>
                  </td>
                  <td className="subedei:p-3">
                    <div className="subedei:flex subedei:flex-wrap subedei:gap-1">
                      {ATTENDANCE_CHOICES.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={s.attendance === status ? "default" : "outline"}
                          onClick={() => markAttendance({ variables: { studentId: s.studentId, status } })}
                        >
                          {ATTENDANCE_LABELS[status]}
                        </Button>
                      ))}
                    </div>
                  </td>
                  <td className="subedei:p-3">
                    {present ? (
                      <>
                        <Badge variant={PICKUP_TONE[pickup] ?? "secondary"}>{PICKUP_LABELS[pickup] ?? pickup}</Badge>
                        {s.pickup.note && (
                          <div className="subedei:text-xs subedei:text-muted-foreground">{s.pickup.note}</div>
                        )}
                        {s.pickup.expectedAt && (
                          <div className="subedei:text-xs subedei:text-muted-foreground">
                            ~{formatTime(s.pickup.expectedAt)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="subedei:text-xs subedei:text-muted-foreground">{s.attendanceNote ?? "—"}</span>
                    )}
                  </td>
                  <td className="subedei:p-3">
                    {s.lastCall ? (
                      <>
                        <Badge variant={callTone(s.lastCall.status)}>{CALL_LABELS[s.lastCall.status]}</Badge>
                        <div className="subedei:text-xs subedei:text-muted-foreground">
                          {PURPOSE_LABELS[s.lastCall.purpose]} · {formatTime(s.lastCall.ringingAt)}
                        </div>
                        {s.lastCall.intent?.summary && (
                          <div className="subedei:text-xs">“{s.lastCall.intent.summary}”</div>
                        )}
                      </>
                    ) : (
                      <span className="subedei:text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="subedei:p-3">
                    <div className="subedei:flex subedei:flex-wrap subedei:gap-1">
                      {present && pickup !== "picked_up" && (
                        <>
                          <Button size="sm" onClick={() => markPickedUp({ variables: { studentId: s.studentId } })}>
                            Авсан
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              callGuardians({ variables: { studentId: s.studentId, purpose: "late_pickup" } })
                            }
                          >
                            <IconPhoneCall />
                            Залгах
                          </Button>
                        </>
                      )}
                      {s.attendance === "absent" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => callGuardians({ variables: { studentId: s.studentId, purpose: "absence" } })}
                        >
                          <IconPhoneCall />
                          Шалтгаан асуух
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export const IndexPage = () => (
  <div className="subedei:flex subedei:h-full subedei:flex-col">
    <PageHeader>
      <PageHeader.Start>
        <Breadcrumb>
          <Breadcrumb.List className="subedei:gap-1">
            <Breadcrumb.Item>
              <Button variant="ghost" asChild>
                <Link to={`/${path}`}>
                  <IconSchool />
                  {manifest.title}
                </Link>
              </Button>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
        <Separator.Inline />
        <PageHeader.FavoriteToggleButton breadcrumb={[manifest.title]} icon="IconSchool" />
      </PageHeader.Start>
      <PageHeader.End>
        <Button variant="outline" asChild>
          <Link to={`/${path}/settings`}>
            <IconSettings />
            Тохиргоо
          </Link>
        </Button>
      </PageHeader.End>
    </PageHeader>
    <div className="subedei:flex-1 subedei:overflow-auto">
      <div className="subedei:mx-auto subedei:w-full subedei:max-w-6xl subedei:p-6">
        <TodayTable />
      </div>
    </div>
  </div>
);
