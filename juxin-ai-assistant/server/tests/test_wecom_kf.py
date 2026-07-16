import respx
from httpx import Response


@respx.mock
def test_wecom_kf_client_syncs_customer_text_and_replies() -> None:
    from app.wecom_kf import WecomKfClient

    class Settings:
        wecom_kf_corp_id = "ww_test"
        wecom_kf_secret = "secret"

    respx.get(url__regex=r"https://qyapi\.weixin\.qq\.com/cgi-bin/gettoken.*").mock(
        return_value=Response(200, json={"errcode": 0, "access_token": "tok", "expires_in": 7200})
    )
    sync = respx.post(url__regex=r"https://qyapi\.weixin\.qq\.com/cgi-bin/kf/sync_msg.*").mock(
        return_value=Response(200, json={
            "errcode": 0,
            "next_cursor": "next-1",
            "msg_list": [
                {"msgid": "m-1", "origin": "customer", "msgtype": "text", "open_kfid": "kf-1", "external_userid": "wm-1", "text": {"content": "资料怎么下载"}},
                {"msgid": "m-2", "origin": "servicer", "msgtype": "text", "external_userid": "wm-1", "text": {"content": "忽略"}},
            ],
        })
    )
    send = respx.post(url__regex=r"https://qyapi\.weixin\.qq\.com/cgi-bin/kf/send_msg.*").mock(
        return_value=Response(200, json={"errcode": 0})
    )

    client = WecomKfClient(Settings())  # type: ignore[arg-type]
    messages, cursor = client.sync_messages(callback_token="callback-token", open_kfid="kf-1")
    assert cursor == "next-1"
    assert [(item.message_id, item.text) for item in messages] == [("m-1", "资料怎么下载")]
    client.send_text(open_kfid="kf-1", external_user_id="wm-1", text="请访问资料库")
    assert sync.called
    assert send.called
