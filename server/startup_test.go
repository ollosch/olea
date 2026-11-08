package main

import (
	"bytes"
	"net"
	"strings"
	"testing"
)

func TestPrintStartupAddressesForLANBind(t *testing.T) {
	var output bytes.Buffer
	printStartupAddresses(&output, "192.168.10.5:8090", &net.TCPAddr{IP: net.ParseIP("192.168.10.5"), Port: 8090})

	text := output.String()
	if !strings.Contains(text, "http://localhost:8090") {
		t.Fatalf("startup output omitted local URL: %s", text)
	}
	if !strings.Contains(text, "On the same Wi-Fi or local network") {
		t.Fatalf("startup output omitted LAN guidance: %s", text)
	}
	if !strings.Contains(text, "http://192.168.10.5:8090") {
		t.Fatalf("startup output omitted usable LAN address: %s", text)
	}
	if !strings.Contains(text, "host firewall") {
		t.Fatalf("startup output omitted firewall guidance: %s", text)
	}
}

func TestPrintStartupAddressesForLoopbackBind(t *testing.T) {
	var output bytes.Buffer
	printStartupAddresses(&output, "127.0.0.1:8090", &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 8090})

	text := output.String()
	if !strings.Contains(text, "http://localhost:8090") {
		t.Fatalf("startup output omitted local URL: %s", text)
	}
	if strings.Contains(text, "On the same Wi-Fi or local network") {
		t.Fatalf("loopback bind advertised a LAN address: %s", text)
	}
}

func TestUniqueStrings(t *testing.T) {
	got := uniqueStrings([]string{"192.0.2.1", "192.0.2.1", "2001:db8::1"})
	if len(got) != 2 || got[0] != "192.0.2.1" || got[1] != "2001:db8::1" {
		t.Fatalf("unexpected unique addresses: %#v", got)
	}
}
